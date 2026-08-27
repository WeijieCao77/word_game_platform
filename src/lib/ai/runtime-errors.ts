/**
 * 把作品在浏览器里抛过的异常，**自动**贴进 AI 每一轮的上下文。
 *
 * 起因是老板照 AI 说的「你先在预览里玩一把」点进去，迎面一条血红的
 * 「这一页出错了：(kids || []).forEach is not a function」——作品根本打不开，
 * 而 AI 已经宣布做好了。
 *
 * 报错其实早就存下来了（沙箱里的兜底脚本 → 外壳 → /api/games/:id/errors），
 * 缺的是**最后一公里**：它只能靠 AI 自己想起来调 read_errors 去问。守则里
 * 写了「每一轮动手之前先看一眼」，可它经常不看——一条没人念的规矩等于没有。
 *
 * 快速模式从来不这样：配置写错了，三级校验的结果每轮都摆在【当前校验结果】里，
 * 想躲都躲不掉。这个文件就是给自由模式补上同一件事——
 * **有错就自动摆在面前，不需要谁记得去问。**
 *
 * 两条边界，都是为了不冤枉作品（误报比不报还坏）：
 *   - 只报存下来的原文，不猜原因、不替它归因
 *   - 分清「最后一次写文件之后抛的」和「上一版留下的」：前者是现在这份代码的问题，
 *     后者可能已经修好了，只是没人清记录。混为一谈会让 AI 去修一个不存在的 bug。
 */

export interface RuntimeError {
  at: string;
  message: string;
  stack: string;
  source: string;
}

/** 最多贴几条：再多也是同一个坏页面的回声，只会挤掉真正有用的上下文 */
const MAX_SHOWN = 6;

function ago(at: string, now: number): string {
  const t = Date.parse(at);
  if (!Number.isFinite(t)) return "";
  const m = Math.round((now - t) / 60_000);
  if (m < 1) return "刚刚";
  if (m < 60) return `${m} 分钟前`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} 小时前`;
  return `${Math.round(h / 24)} 天前`;
}

/** 堆栈只留最上面几行——再往下全是运行库和浏览器的帧，对定位没用还占地方 */
function briefStack(stack: string): string {
  const lines = stack
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 3);
  return lines.length > 0 ? lines.map((l) => `     ${l}`).join("\n") : "";
}

/**
 * 生成【运行报错】那一段。没有报错就返回空串（这一段整块不出现，不占额度）。
 *
 * @param errors    存储层给的报错列表（最新的在最前面）
 * @param lastWrite 最后一次写文件的时间；用来分辨「这一版抛的」和「上一版留下的」
 */
export function describeRuntimeErrors(errors: RuntimeError[], lastWrite?: string, now = Date.now()): string {
  if (errors.length === 0) return "";
  const writeAt = lastWrite ? Date.parse(lastWrite) : NaN;
  const shown = errors.slice(0, MAX_SHOWN);
  let fresh = 0;

  const lines = shown.map((e, i) => {
    const t = Date.parse(e.at);
    // 报错比最后一次写文件还新 = 现在这份代码跑出来的，赖不掉
    const after = Number.isFinite(writeAt) && Number.isFinite(t) && t >= writeAt;
    if (after) fresh += 1;
    const tag = after ? "【这一版抛的】" : "【上一版留下的，可能已修好】";
    const where = e.source ? `（${e.source}）` : "";
    const stack = briefStack(e.stack);
    return `${i + 1}. ${tag} ${e.message}${where}　${ago(e.at, now)}` + (stack ? `\n${stack}` : "");
  });

  const head =
    fresh > 0
      ? `⚠ 这部作品**现在打不开或跑不动**：最后一次写文件之后，它在浏览器里又抛了 ${fresh} 条异常。\n` +
        `别的都往后放，先把它们修掉——作者点开预览看到的就是这个。`
      : `这部作品之前抛过 ${errors.length} 条异常（都发生在最后一次写文件之前，可能已经修好了）。\n` +
        `顺手确认一下还在不在；确认修好了就调 read_errors 带 clear: true 把记录清掉。`;

  const tail =
    fresh > 0
      ? `\n修完之后调 read_errors 带 clear: true 清掉记录——不清的话下一轮分不出你到底修没修好。\n` +
        `注意：这些是**运行时**的错，语法检查一个都拦不住，只能靠自己把出错那条路径从头走一遍。`
      : "";

  return `${head}\n${lines.join("\n")}${tail}`;
}

/**
 * 只挑「最后一次写文件之后」抛的报错。
 *
 * 连续搭建要靠这个判断「上一轮是不是把作品写炸了」——旧报错不能算数，
 * 不然一条没人清的历史记录会让接下来每一轮都去修一个早就修好的 bug。
 * 拿不到写文件的时间就一条都不算（宁可漏，不可冤）。
 */
export function freshRuntimeErrors(errors: RuntimeError[], lastWrite?: string): RuntimeError[] {
  const writeAt = lastWrite ? Date.parse(lastWrite) : NaN;
  if (!Number.isFinite(writeAt)) return [];
  return errors.filter((e) => {
    const t = Date.parse(e.at);
    return Number.isFinite(t) && t >= writeAt;
  });
}
