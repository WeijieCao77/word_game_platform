/**
 * 数据集：让作品的「数据」和「代码」分开。
 *
 * 起因是复刻 VAL MANAGER 那张卡点表上最后一条——原作有 78 支战队、518 名选手，
 * 这种东西不该硬编在 js 里：AI 一条条生成要烧掉整轮预算，作者想换成自己的真实赛事
 * 数据也没处放。它该是一张表，作者直接上传，代码只管怎么用。
 *
 * 但沙箱里 CSP 写着 connect-src 'none'，作品**发不出任何请求**，读不到 .csv。
 * 所以平台在 /play 下给每张数据表虚拟出一个同名的 .js 孪生文件：
 *
 *     作者上传 data/roster.csv
 *     作品里写 <script src="data/roster.js"></script>
 *     代码里取 WGP.data("roster")   // 一个对象数组
 *
 * 这样既不放松沙箱，又让数据规模上了一个台阶。
 */

/** 一张数据表解析出来的行 */
export type DataRow = Record<string, string | number | boolean | null>;

/** 单个字段过长多半是文件格式不对（比如把整份 json 当成一行 csv） */
const MAX_CELL = 20_000;

/**
 * 解析 CSV。按 RFC4180 那套来：双引号包裹的字段里允许逗号、换行和 "" 转义的引号。
 * 第一行是表头；空行跳过；列数对不上就按表头补齐或截断（宁可少一列，不要整表报废）。
 */
export function parseCsv(text: string): DataRow[] {
  const rows = splitCsvRows(text);
  if (rows.length === 0) return [];
  const head = rows[0].map((h, i) => h.trim() || `列${i + 1}`);
  const out: DataRow[] = [];
  for (let i = 1; i < rows.length; i++) {
    const cells = rows[i];
    // 全空的行是尾巴上的空白，不是数据
    if (cells.every((c) => c.trim() === "")) continue;
    const row: DataRow = {};
    for (let c = 0; c < head.length; c++) row[head[c]] = coerce(cells[c] ?? "");
    out.push(row);
  }
  return out;
}

/** 把 CSV 切成「行 × 单元格」，认引号、认 \r\n */
function splitCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text; // 去掉 Excel 存的 BOM

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"' && cell === "") {
      quoted = true;
    } else if (ch === ",") {
      row.push(cell.slice(0, MAX_CELL));
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(cell.slice(0, MAX_CELL));
      rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell !== "" || row.length) {
    row.push(cell.slice(0, MAX_CELL));
    rows.push(row);
  }
  return rows;
}

/** 数字就当数字用，别让作者在代码里到处 Number()；true/false/空也照直译 */
function coerce(raw: string): string | number | boolean | null {
  const v = raw.trim();
  if (v === "") return null;
  if (v === "true") return true;
  if (v === "false") return false;
  // 只认干净的十进制数：前导零的编号（"007"）保持字符串，不然会被吃掉
  if (/^-?(0|[1-9]\d*)(\.\d+)?$/.test(v)) {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return v;
}

/** 这条路径是不是一张数据表 */
export function isDatasetPath(path: string): boolean {
  return /^data\/[A-Za-z0-9._-]+\.(csv|json)$/.test(path);
}

/**
 * 数据表 → 孪生 js 的路径映射。
 * 请求 data/roster.js 时，先找 data/roster.csv，再找 data/roster.json。
 */
export function datasetSourcesFor(jsPath: string): { name: string; candidates: string[] } | null {
  const m = /^data\/([A-Za-z0-9._-]+)\.js$/.exec(jsPath);
  if (!m) return null;
  const name = m[1];
  return { name, candidates: [`data/${name}.csv`, `data/${name}.json`] };
}

/**
 * 把一张表包成作品能用 <script src> 引进去的样子。
 * 不用 fetch、不用 eval——就是一段赋值语句。
 */
export function wrapDataset(name: string, path: string, text: string): string {
  let value: unknown;
  if (path.endsWith(".json")) {
    try {
      value = JSON.parse(text);
    } catch (e) {
      // 数据坏了不能让整部作品白屏：挂一个空表，并在控制台说清哪张表坏了
      return (
        `/* ${path} 不是合法 JSON，已当成空表处理 */\n` +
        `(function(){window.WGP_DATA=window.WGP_DATA||{};` +
        `window.WGP_DATA[${JSON.stringify(name)}]=[];` +
        `console.error(${JSON.stringify(`[WGP] 数据表 ${path} 解析失败：${(e as Error).message}`)});})();\n`
      );
    }
  } else {
    value = parseCsv(text);
  }
  const json = JSON.stringify(value);
  const count = Array.isArray(value) ? value.length : 1;
  return (
    `/* 由 ${path} 自动生成 · ${count} 条 · 取用：WGP.data(${JSON.stringify(name)}) */\n` +
    `(function(){window.WGP_DATA=window.WGP_DATA||{};` +
    `window.WGP_DATA[${JSON.stringify(name)}]=${json};})();\n`
  );
}
