/**
 * 一部作品能放多少文件、多大——预算分成两本账。
 *
 * 起因是老板问的一句话：「我的数据文件 csv 有几十个怎么办」。
 *
 * 原来只有一个数字：**一部作品最多 60 个文件**，代码和数据表共用。
 * 于是几十张 CSV 一传，AI 写代码的额度就被吃掉一大半——而 VAL MANAGER 那个量级，
 * 光作品自己的页面文件就有九个。两样东西挤在同一个预算里，规模一上来必然打架。
 *
 * 所以拆成两本账：
 *
 * - **代码文件**（页面、脚本、样式）：还是 60 个。作品结构再复杂也用不到这么多，
 *   真超了多半是该合并而不是该放宽。
 * - **数据表**（`data/` 下面的 csv/json）：另算 200 张。它们是素材不是作品结构，
 *   一个联赛几十张表很正常，不该跟代码抢名额。
 *
 * 另加一条原来**根本没有**的闸门：**整部作品的总字节数**。
 * 原来单文件 40 万字符 × 60 个 = 一部作品理论上能吃掉一百多兆；
 * 现在把文件数放宽到 260，不配一道总量闸门就是给存储开了个口子。
 */

/** 单个文件的大小上限：一份文字游戏的 index.html 再大也到不了这个数 */
export const MAX_FILE = 400_000;
/** 代码文件（不在 data/ 下的）数量上限 */
export const MAX_CODE_FILES = 60;
/** 数据表（data/ 下的）数量上限，跟代码文件分开算 */
export const MAX_DATA_FILES = 200;
/** 整部作品的总字节数上限 */
export const MAX_TOTAL_BYTES = 40_000_000;

/** `data/` 下面的才算数据表；其余都算作品自己的代码文件 */
export function isDataFile(path: string): boolean {
  return path.startsWith("data/");
}

export interface ExistingFile {
  path: string;
  size: number;
}

export type BudgetVerdict = { ok: true } | { ok: false; error: string };

/**
 * 写一个文件之前先过这道账。
 *
 * 覆盖已有文件不占新名额，但**要按差额算总量**——不然反复覆盖同一个大文件，
 * 总量会被算成节节高。
 */
export function checkFileBudget(
  existing: ExistingFile[],
  path: string,
  byteLength: number
): BudgetVerdict {
  if (byteLength > MAX_FILE) {
    return { ok: false, error: `单个文件不能超过 ${MAX_FILE / 1000}k 字符，把它拆开` };
  }

  const prev = existing.find((f) => f.path === path);
  const isNew = !prev;

  if (isNew) {
    const data = isDataFile(path);
    const used = existing.filter((f) => isDataFile(f.path) === data).length;
    const cap = data ? MAX_DATA_FILES : MAX_CODE_FILES;
    if (used >= cap) {
      return {
        ok: false,
        error: data
          ? `数据表最多 ${cap} 张（当前 ${used} 张）。合并几张表，或者把用不到的删掉`
          : `代码文件最多 ${cap} 个（当前 ${used} 个）。把零碎的文件合并一下`,
      };
    }
  }

  // 总量按差额算：覆盖同一个文件时，只多算「新的比旧的多出来」那部分
  const total = existing.reduce((n, f) => n + f.size, 0) - (prev?.size ?? 0) + byteLength;
  if (total > MAX_TOTAL_BYTES) {
    return {
      ok: false,
      error: `整部作品最多 ${Math.round(MAX_TOTAL_BYTES / 1_000_000)}MB（这次会到 ${(
        total / 1_000_000
      ).toFixed(1)}MB）。删掉用不到的数据表再传`,
    };
  }

  return { ok: true };
}

/**
 * 把上传时的相对路径压成一个数据表名。
 *
 * 数据表的孪生 js 机制（见 `dataset.ts`）只认 `data/<名字>.csv` 这一层，
 * 名字里不能有斜杠。而作者选一整个文件夹传上来时，路径常常是带层级的
 * （`teams/pacific.csv`、`players/2026.csv`）。
 *
 * 所以把层级压成横线：`teams/pacific.csv` → `data/teams-pacific.csv`，
 * 代码里 `WGP.data("teams-pacific")` 取用。压平而不是丢掉前缀，
 * 是为了两个文件夹里的同名文件不会互相覆盖。
 */
export function dataPathFromUpload(relativePath: string): string {
  const joined = relativePath
    .replace(/\\/g, "/")
    .split("/")
    .filter((seg) => seg && seg !== "." && seg !== "..")
    .join("-");

  // 扩展名单独摘出来再清洗名字主体。合在一起清的话，
  // 「队伍 表.csv」这种全中文的名字会被清成空，最后只剩个 csv——
  // 于是几十张中文名的表全撞到同一个路径上，互相覆盖。自测第一条就是这么抓出来的。
  const extMatch = /\.(csv|json)$/i.exec(joined);
  const ext = extMatch ? extMatch[0].toLowerCase() : ".csv";
  const stemRaw = extMatch ? joined.slice(0, -extMatch[0].length) : joined;

  // 只把 ASCII 里不能进路径的字符换成横线；**中文之类的非 ASCII 原样保留**。
  // 早先一刀切成 [^A-Za-z0-9._-] 的后果是「队伍表.csv」被清成空，
  // 几十张中文名的表全撞到同一个路径上；退一步用哈希兜底又变成
  // WGP.data("t-e0w92b")——你和 AI 都认不出这是哪张表。留住原名才是对的。
  const stem = stemRaw
    .replace(/[\x00-\x1f\x7f]/g, "")
    .replace(/[^A-Za-z0-9._\u0080-\uffff-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+/, "")
    .replace(/[-.]+$/, "")
    .toLowerCase();

  // 清完还是什么都不剩（比如整个名字都是 emoji）才用稳定短哈希兜底：
  // 同一个文件名永远得到同一个名字，不同文件名不会撞车。
  // 名字跟原文件名对不上没关系——上传完界面会把「原名 → 取用名」列出来。
  return `data/${stem || `t-${shortHash(stemRaw)}`}${ext}`;
}

/**
 * 一个很小的稳定哈希（FNV-1a）。
 *
 * 不用 node:crypto：这个文件被工作台的客户端组件直接引用，
 * 带 node 内置模块进去会把打包搞坏。
 */
function shortHash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36).padStart(6, "0").slice(0, 6);
}

/** 数据表路径 → 代码里 WGP.data() 要用的名字 */
export function dataNameOf(path: string): string {
  return path.replace(/^data\//, "").replace(/\.(csv|json)$/i, "");
}
