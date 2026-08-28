/**
 * AI 调用失败之后，说给人听的那一段。
 *
 * 这个文件是被一次真事故逼出来的：作者在工作台发了一句「把采信簿从推理结论
 * 改成物理陈述」，等了一会儿，对话里冒出来一行——
 *
 *     ⚠ terminated
 *
 * 就这一个词。没有原因、没有下一步、没有「这一轮还在不在」。
 *
 * 追下来是三处叠在一起：
 *
 *   1. `terminated` 是 **Node 的 fetch（undici）** 抛的原话：上游把流从中间掐断时，
 *      它抛 `TypeError: terminated`，`message` 字面上就只有这一个词，
 *      **真正的原因放在 `err.cause` 里**（`other side closed` / `ECONNRESET` …）。
 *   2. 调用方写的是 `err instanceof Error ? err.message : String(err)`——
 *      **cause 整个丢了**。最有用的那半句信息在第一步就没了。
 *   3. `explainAiFailure` 有一条专管网络的分支（timeout / etimedout / fetch failed /
 *      socket），可 `terminated` 一个都不匹配，于是掉到最后一行原样吐出来。
 *
 * 所以这里做两件事：**把 cause 链摊平**，以及**认得出这一类断线**。
 *
 * 单独成一个文件，是为了这两样能进 `npm test`——它们原来是路由文件里的私有函数，
 * 一行都测不到。而「错误信息说得清不清楚」恰恰是最该被测的东西之一。
 */

/**
 * 把一个异常摊成一句能读的话，**连 `cause` 链一起**。
 *
 * `TypeError: terminated` 这种 message 只有一个词的错误，全部信息都在 cause 上；
 * 只取 message 等于把故障原因扔了。`code`（ECONNRESET、UND_ERR_SOCKET…）也一并带上。
 */
export function errorDetail(err: unknown, depth = 0): string {
  if (depth > 4) return "";
  if (!(err instanceof Error)) {
    const s = String(err ?? "").trim();
    return s;
  }
  const parts: string[] = [];
  const code = (err as { code?: unknown }).code;
  parts.push(err.message || err.name || "未知错误");
  if (typeof code === "string" && code && !err.message.includes(code)) parts.push(code);

  const inner = errorDetail((err as { cause?: unknown }).cause, depth + 1);
  // 内层没有新信息就不要重复套娃
  if (inner && !parts.some((p) => p.includes(inner))) {
    return `${parts.join(" / ")}（起因：${inner}）`;
  }
  return parts.join(" / ");
}

/** 一类断线：连上了、但传到一半没了 */
const CUT_OFF =
  /(terminated|other side closed|econnreset|socket hang up|premature close|aborted|und_err|epipe|stream closed|stream idle timeout)/i;

/** 一类连不上或太慢 */
const SLOW = /(timeout|etimedout|fetch failed|socket|enotfound|econnrefused|eai_again|network)/i;

/**
 * 把原始错误翻译成「哪儿不行 + 该怎么办」。
 *
 * 规矩：**每一条都要给下一步**。只说「失败了」等于没说——作者拿着一个
 * `terminated` 什么也做不了，还不知道自己那一轮是不是白花了。
 */
export function explainAiFailure(detail: string): string {
  const d = detail.toLowerCase();
  const tail = detail.slice(0, 160);

  if (d.includes("context") && (d.includes("length") || d.includes("exceed"))) {
    return `这轮对话太长了，超出模型的上下文上限。建议：把要求拆小一点重发，或者新开一个作品从设计卡继续。（原始错误：${tail}）`;
  }
  if (d.includes("max_tokens") || d.includes("too long") || d.includes("output limit")) {
    return `这一轮要生成的内容超过了模型单次输出上限——十几个队伍、几十名选手一次性建出来必然超。让它先建骨架，再分批补名单（每批 15~25 条）。（原始错误：${tail}）`;
  }
  if (d.includes("429") || d.includes("rate limit")) {
    return `AI 服务限流了，等一两分钟再试。（原始错误：${tail}）`;
  }
  if (d.includes("401") || d.includes("403") || d.includes("invalid api key")) {
    return `AI 服务拒绝了这次调用，多半是密钥失效或余额不足，需要在部署环境变量里更新。（原始错误：${tail}）`;
  }
  // 这一条要排在 SLOW 前面，有两个理由：
  //   1. terminated 里不含 timeout/socket 这些词，排后面它会掉进兜底
  //   2. 反过来「stream idle timeout」里含 timeout，排后面它会被归成「连不上」——
  //      可它明明是连上了传到一半没的，作者最想知道的「半份文件丢没丢、要不要重发」
  //      在「超时」那条话里一个字都没有
  if (CUT_OFF.test(d)) {
    return (
      `跟 AI 服务的连接**传到一半断了**（不是超时，是对面把连接掐了）。` +
      `这一轮没写完的部分不会落盘，**已经写进去的文件不会丢**——` +
      `先看一眼「文件」页签确认改到哪儿了，再把刚才那句话重发一次。` +
      `要是连着断好几次，多半是这一轮要改的东西太多，拆小一点更稳。（原始错误：${tail}）`
    );
  }
  if (SLOW.test(d)) {
    return `连接 AI 服务超时或中断。稍等片刻重试；如果这一轮改动很大，先把要求拆小。（原始错误：${tail}）`;
  }
  return detail || "AI 请求失败";
}
