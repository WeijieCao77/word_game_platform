/**
 * 「文件都写好了，游戏却打不开」——接线体检。
 *
 * 这是实测里真撞出来的一次：作品有 **9 个文件、145,137 字符、11 个主界面全在**，
 * 可玩家打开只看到 64 个字符的一片空白，控制台一句 `registerSetup is not defined`。
 * 原因是 index.html 里少了一行 `<script src="screens-setup.js">`——
 * 文件写进去了，但**没人加载它**。
 *
 * 平台原来的第一级校验只查**单个文件的语法**（vm.Script 编译一遍），
 * 每个文件单独看都完全正确，所以一路放行。缺的是这一层：
 * **这些文件拼在一起能不能跑起来。**
 *
 * 两件事查得出来、也值得查：
 *
 * 1. **有文件没人加载**（孤儿）——上面那次事故就是它。写了 screens-setup.js
 *    却忘了在 index.html 里引，于是里面定义的函数全世界都找不到。
 * 2. **引了不存在的文件**（断链）——`<script src="game.js">` 但根本没有 game.js，
 *    浏览器静默 404，同样是一片空白。
 *
 * 只报告，不拦截：写文件的正常节奏就是「先写新文件、下一步再接进 index.html」，
 * 拦下来反而挡住正常干活。把话说给 AI 听就够了——它看得见就会去接。
 */
import { isRuntimeAsset } from "@/lib/runtime";

export interface WiringReport {
  /** 存在但没被 index.html 引用的代码文件 */
  orphans: string[];
  /** index.html 引了、但作品里没有的本地文件 */
  broken: string[];
}

/** 从 html 里取出本地引用（跳过 http(s):// 、// 、data: 、blob: 与平台运行库） */
function localRefs(html: string): string[] {
  const out: string[] = [];
  const add = (src: string): void => {
    if (!src) return;
    if (/^(https?:)?\/\//i.test(src) || /^(data|blob|#|mailto:)/i.test(src)) return;
    // 平台自己提供的运行库与数据表是虚拟文件，不在作品的文件列表里。
    //
    // 这里原来只挡住了 `wgp/...` 这种带斜杠的路径，**漏了 `wgp.js` / `wgp.css`
    // 这两个虚拟文件名**——而平台自己的空白模板 index.html 引的正是它们。
    // 后果是每部作品都被报一句「index.html 引用了 wgp.css，可作品里没有这个文件」：
    // 一直在误导 AI，接进发布门槛之后更会**把每一部作品都拦在发布之外**。
    // 发布门槛端到端自测第一关就撞上了这个。
    if (/^\/?wgp\//i.test(src)) return;
    if (isRuntimeAsset(src.replace(/^\.?\//, "").split(/[?#]/)[0])) return;
    out.push(src.replace(/^\.?\//, "").split(/[?#]/)[0]);
  };
  const re = /<(?:script|link)\b[^>]*?\b(?:src|href)\s*=\s*("|')([^"']+)\1/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) add(m[2]);
  return out;
}

/**
 * 体检：把作品的文件清单和 index.html 对一遍。
 *
 * `files` 是「路径 → 内容」，只需要 index.html 的内容是真的，其余给空串也行
 * （我们只关心它在不在）。
 */
export function checkWiring(files: Record<string, string>): WiringReport {
  const paths = Object.keys(files);
  const index = paths.find((p) => /(^|\/)index\.html$/i.test(p));
  if (!index) return { orphans: [], broken: [] };

  const refs = new Set(localRefs(files[index] ?? ""));
  // data/ 下是数据表（通过 WGP.data 取，不用 script 标签引），不算孤儿
  const code = paths.filter((p) => p !== index && /\.(js|mjs|css)$/i.test(p) && !p.startsWith("data/"));

  return {
    orphans: code.filter((p) => !refs.has(p)),
    broken: [...refs].filter((r) => /\.(js|mjs|css)$/i.test(r) && !paths.includes(r)),
  };
}

/** 把体检结果写成一句给 AI 看的话；没问题就返回空串 */
export function describeWiring(r: WiringReport): string {
  const lines: string[] = [];
  if (r.orphans.length > 0) {
    lines.push(
      `⚠ 这些文件写进去了，但 index.html 里没有加载它们：${r.orphans.join("、")}。` +
        `里面定义的函数在运行时**一个都找不到**（玩家看到的是一片空白 + 「xxx is not defined」）。` +
        `补上对应的 <script src="…"> / <link rel="stylesheet" href="…">，注意顺序：` +
        `被别人调用的文件要排在前面。`
    );
  }
  if (r.broken.length > 0) {
    lines.push(
      `⚠ index.html 引用了不存在的文件：${r.broken.join("、")}。` +
        `浏览器会静默 404，页面同样起不来。要么把文件写出来，要么把这行引用删掉。`
    );
  }
  return lines.join("\n");
}
