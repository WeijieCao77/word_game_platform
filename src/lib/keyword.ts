/** 关键词归一化：小写、全角转半角、去所有空白——「输入 陈 默」也能命中「陈默」。
 * 引擎匹配与校验器查重共用（独立小模块避免 schema↔engine 循环依赖）。 */
export function normalizeKeyword(s: string): string {
  let out = "";
  for (const ch of s.toLowerCase()) {
    const code = ch.charCodeAt(0);
    if (code === 0x3000) out += " ";
    else if (code >= 0xff01 && code <= 0xff5e) out += String.fromCharCode(code - 0xfee0);
    else out += ch;
  }
  return out.replace(/\s+/g, "");
}
