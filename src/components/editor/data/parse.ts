// 表格解析：作者的 CSV / TSV / JSON 在浏览器里就地解析成行列，
// 服务器不碰原始文件——只有作者确认导入后，数据才作为游戏配置的一部分入库。
//
// 自己写解析器而不是拉库：CSV 的坑就那几个（引号内的逗号与换行、""转义、BOM、CRLF），
// 三十行能覆盖，比多一个依赖划算。

export interface Table {
  columns: string[];
  rows: Record<string, string>[];
  /** 超出上限被截断时为 true */
  truncated: boolean;
}

export const MAX_ROWS = 500;
export const MAX_COLS = 40;

/** 逗号还是制表符：看首行哪种更多 */
function sniffDelimiter(firstLine: string): string {
  const commas = (firstLine.match(/,/g) ?? []).length;
  const tabs = (firstLine.match(/\t/g) ?? []).length;
  const semis = (firstLine.match(/;/g) ?? []).length;
  if (tabs > commas && tabs >= semis) return "\t";
  if (semis > commas) return ";";
  return ",";
}

/** 一行行切分，尊重引号（引号内的分隔符和换行都算内容） */
function splitRecords(text: string, delim: string): string[][] {
  const out: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += c;
      }
      continue;
    }
    if (c === '"') {
      quoted = true;
    } else if (c === delim) {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      field = "";
      out.push(row);
      row = [];
    } else if (c !== "\r") {
      field += c;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    out.push(row);
  }
  return out.filter((r) => r.some((cell) => cell.trim() !== ""));
}

/** CSV / TSV 文本 → 表格（首行当表头） */
export function parseDelimited(raw: string): Table {
  const text = raw.replace(/^﻿/, "").trim();
  if (!text) return { columns: [], rows: [], truncated: false };
  const delim = sniffDelimiter(text.split("\n")[0] ?? "");
  const records = splitRecords(text, delim);
  if (records.length === 0) return { columns: [], rows: [], truncated: false };

  const header = records[0].map((h, i) => h.trim() || `列${i + 1}`);
  const columns = dedupeColumns(header).slice(0, MAX_COLS);
  const body = records.slice(1);
  const rows = body.slice(0, MAX_ROWS).map((r) => {
    const obj: Record<string, string> = {};
    columns.forEach((c, i) => {
      obj[c] = (r[i] ?? "").trim();
    });
    return obj;
  });
  return { columns, rows, truncated: body.length > MAX_ROWS || header.length > MAX_COLS };
}

/** JSON 数组（对象数组或二维数组）→ 表格 */
export function parseJsonTable(raw: string): Table {
  const data = JSON.parse(raw);
  const list = Array.isArray(data) ? data : Array.isArray(data?.rows) ? data.rows : Array.isArray(data?.data) ? data.data : null;
  if (!list) throw new Error("JSON 里没找到数组：请给一个对象数组，或者 { rows: [...] } 这样的结构");
  if (list.length === 0) return { columns: [], rows: [], truncated: false };

  if (Array.isArray(list[0])) {
    const header = (list[0] as unknown[]).map((h, i) => String(h ?? "").trim() || `列${i + 1}`);
    const columns = dedupeColumns(header).slice(0, MAX_COLS);
    const rows = (list.slice(1) as unknown[][]).slice(0, MAX_ROWS).map((r) => {
      const obj: Record<string, string> = {};
      columns.forEach((c, i) => {
        obj[c] = cellToString(r[i]);
      });
      return obj;
    });
    return { columns, rows, truncated: list.length - 1 > MAX_ROWS };
  }

  const keys: string[] = [];
  for (const item of list.slice(0, MAX_ROWS)) {
    for (const k of Object.keys(item ?? {})) if (!keys.includes(k)) keys.push(k);
  }
  const columns = keys.slice(0, MAX_COLS);
  const rows = list.slice(0, MAX_ROWS).map((item: Record<string, unknown>) => {
    const obj: Record<string, string> = {};
    for (const c of columns) obj[c] = cellToString(item?.[c]);
    return obj;
  });
  return { columns, rows, truncated: list.length > MAX_ROWS || keys.length > MAX_COLS };
}

/** 按文件名/内容自动选解析器 */
export function parseTable(raw: string, filename?: string): Table {
  const looksJson = /\.json$/i.test(filename ?? "") || /^[[{]/.test(raw.trim());
  return looksJson ? parseJsonTable(raw) : parseDelimited(raw);
}

function cellToString(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v).trim();
}

function dedupeColumns(header: string[]): string[] {
  const seen = new Map<string, number>();
  return header.map((h) => {
    const n = seen.get(h) ?? 0;
    seen.set(h, n + 1);
    return n === 0 ? h : `${h}_${n + 1}`;
  });
}

/**
 * 这一列能不能当数值属性用：七成以上的非空单元格是数字就算。
 * 留三成余量是因为真实数据里常有 "-"、"N/A"、"未公开" 这类占位，
 * 不该因为几个空位就把整列判成文本。
 */
export function isNumericColumn(rows: Record<string, string>[], col: string): boolean {
  const vals = rows.map((r) => r[col]).filter((v) => v !== undefined && v !== "");
  if (vals.length === 0) return false;
  const nums = vals.filter((v) => Number.isFinite(Number(v.replace(/[,%]/g, ""))));
  return nums.length / vals.length >= 0.7;
}

export function toNumber(v: string | undefined): number {
  const n = Number((v ?? "").replace(/[,%]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

/** 中文列名也要能变成合法 id：保留中文与字母数字，其余换成下划线，并保证唯一 */
export function toId(name: string, used: Set<string>): string {
  const base = (name || "字段").replace(/[^\w一-龥]+/g, "_").replace(/^_+|_+$/g, "") || "字段";
  let id = base;
  let n = 2;
  while (used.has(id)) id = `${base}_${n++}`;
  used.add(id);
  return id;
}
