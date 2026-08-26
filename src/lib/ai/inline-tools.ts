import type { ToolCall } from "./provider";

/**
 * 把「混在正文里的工具调用」捞出来。
 *
 * 起因是一次线上实测：AI 明明要改配置，回给创作者的却是这么一坨——
 *
 *   <｜｜DSML｜｜tool_calls>
 *   <｜｜DSML｜｜invoke name="update_config">
 *   <｜｜DSML｜｜parameter name="config" string="false">{…}</｜｜DSML｜｜parameter>
 *   </｜｜DSML｜｜invoke>
 *   </｜｜DSML｜｜tool_calls>
 *
 * 也就是模型没走 tool_calls 那条结构化通道，而是把调用**当成正文吐了出来**。
 * 后果有三层，一层比一层重：
 *   1. 创作者看到一坨标记，以为平台坏了
 *   2. 这一轮的活白干——工具没被执行，配置/文件一个字都没落
 *   3. 那一轮的 token 照收（实测里这样烧掉了两轮，十几万 token）
 *
 * 不同厂商、不同网关漏出来的花样不一样，所以这里认几种常见形状，认不出就原样放行。
 * 捞出来之后正文里那段标记要抹掉——创作者不该看见这些。
 */

/** 全角竖线（U+FF5C）和半角竖线都可能出现在分隔符里 */
const BAR = "[｜|]*";
/** <｜｜DSML｜｜invoke …> 里的 DSML 前缀，也可能整个没有 */
const TAG = `(?:${BAR}DSML${BAR})?`;

const INVOKE = new RegExp(`<${TAG}invoke\\s+name="([^"]+)"\\s*>([\\s\\S]*?)</${TAG}invoke>`, "g");
const PARAM = new RegExp(`<${TAG}parameter\\s+name="([^"]+)"([^>]*)>([\\s\\S]*?)</${TAG}parameter>`, "g");
/** 包在外面的 <tool_calls> … </tool_calls>，抹正文时要一并去掉 */
const WRAP = new RegExp(`</?${TAG}tool_calls>`, "g");
/** 另一种常见漏法：<tool_call>{"name":…,"arguments":{…}}</tool_call> */
const JSON_CALL = /<tool_call>\s*(\{[\s\S]*?\})\s*<\/tool_call>/g;

export interface Recovered {
  /** 抹掉标记之后的正文（可能变成空字符串） */
  text: string;
  /** 捞出来的调用，顺序跟正文里出现的顺序一致 */
  calls: ToolCall[];
}

/** 正文里看着像不像有漏出来的工具调用——先粗筛，绝大多数回复根本走不到解析 */
export function looksInline(text: string): boolean {
  return /<[｜|]*(?:DSML[｜|]*)?(?:invoke|tool_calls?)\b/.test(text);
}

export function recoverInlineToolCalls(text: string): Recovered {
  if (!text || !looksInline(text)) return { text, calls: [] };

  const calls: ToolCall[] = [];
  let cleaned = text;

  // 一、invoke / parameter 那套
  cleaned = cleaned.replace(INVOKE, (whole, name: string, inner: string) => {
    const args: Record<string, unknown> = {};
    PARAM.lastIndex = 0;
    let m: RegExpExecArray | null;
    let found = false;
    while ((m = PARAM.exec(inner)) !== null) {
      found = true;
      args[m[1]] = readValue(m[3], m[2]);
    }
    // 一个参数都没解析出来说明形状不对，原样留着别乱动
    if (!found) return whole;
    calls.push(makeCall(name, args, calls.length));
    return "";
  });

  // 二、<tool_call>{json}</tool_call> 那套
  cleaned = cleaned.replace(JSON_CALL, (whole, raw: string) => {
    try {
      const obj = JSON.parse(raw) as { name?: string; arguments?: unknown; parameters?: unknown };
      if (!obj.name) return whole;
      const args = obj.arguments ?? obj.parameters ?? {};
      calls.push(makeCall(obj.name, typeof args === "string" ? safeParse(args) : args, calls.length));
      return "";
    } catch {
      return whole;
    }
  });

  if (calls.length === 0) return { text, calls: [] };
  return { text: cleaned.replace(WRAP, "").trim(), calls };
}

/**
 * 参数值怎么读。
 * 标记里带 string="false" 的意思是「这不是字符串，是 JSON 值」——
 * 配置整个对象就是这么传的，当字符串收会变成一坨转义。
 */
function readValue(raw: string, attrs: string): unknown {
  const body = raw.trim();
  if (/string\s*=\s*"false"/.test(attrs)) return safeParse(body);
  // 没标注的也试一下：长得像 JSON 对象/数组就当 JSON，读错了不如原样当字符串
  if (/^[[{]/.test(body)) {
    const parsed = safeParse(body);
    if (parsed !== body) return parsed;
  }
  return body;
}

function safeParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}

function makeCall(name: string, args: unknown, i: number): ToolCall {
  return {
    id: `inline_${i}`,
    type: "function",
    function: { name, arguments: JSON.stringify(args ?? {}) },
  };
}
