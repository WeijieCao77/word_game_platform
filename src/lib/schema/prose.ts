// 文笔体检：机检「AI 腔」。
//
// 恋爱与悬疑类靠文笔立命——玩家要的是「在读小说」的质感，不是「在读一份说明书」。
// 但「写得好」没法机检，「写得像 AI」可以：AI 写中文有一批极其稳定的坏习惯，
// 密度一高，读起来就假。这里只查那些**能数出来**的，数出来就把原句指给作者看。
//
// 判定原则：单条不算病，密度才算病。人类作者偶尔也会写「仿佛」，
// 但每三行就来一个「仿佛」「不禁」「缓缓」，那就是模型在凑字。

export interface ProseIssue {
  /** 病症名，如「套话密度过高」 */
  kind: string;
  /** 给作者看的话 */
  message: string;
  /** 犯病的原句（最多三条） */
  samples: string[];
}

/**
 * AI 中文最稳定的一批口头禅。
 * 挑选标准：①模型高频，人类低频；②替换掉几乎总是更好；③不依赖题材。
 */
const TICS = [
  "仿佛", "仿若", "宛如", "犹如", "似乎", "彷佛",
  "不禁", "不由得", "不由自主", "情不自禁",
  "缓缓", "轻轻", "微微", "淡淡", "静静地", "默默地",
  "一丝", "一抹", "一缕", "一阵", "些许", "莫名",
  "深深地", "深深", "久久", "渐渐", "悄然",
  "心中", "心底", "心头", "眼底", "眸中", "嘴角",
  "空气仿佛", "时间仿佛", "空气中弥漫",
  "无声地", "无言地", "怔怔",
];

/** 「每段都要升华」是 AI 写作最容易暴露的毛病 */
const UPLIFT = [
  "或许这就是", "也许这就是", "这或许就是", "这也许就是",
  "无论如何", "总之", "最终", "从此以后", "从那以后",
  "在这一刻", "在那一刻", "这一刻",
  "命运", "宿命", "注定",
];

/**
 * 形容词轰炸：连着三个以上「XX的」，中间有没有顿号都算。
 * 「温柔的、和煦的、明亮的阳光」和「昏黄摇曳的温暖的柔和的灯光」是同一种病。
 */
const ADJ_PILE = /(?:[一-龥]{2,4}的[、，]?\s*){3,}/g;

function chineseLength(text: string): number {
  return (text.match(/[一-龥]/g) ?? []).length;
}

function sentencesOf(text: string): string[] {
  return text
    .split(/[。！？…\n]/)
    .map((s) => s.trim())
    .filter((s) => chineseLength(s) >= 4);
}

/**
 * 体检一批文本。
 *
 * @param texts 作品里玩家真的会读到的所有段落
 * @param opts.minChars 少于这个字数不体检（刚起步的作品没必要挑刺）
 */
export function auditProse(
  texts: string[],
  opts: { minChars?: number } = {}
): ProseIssue[] {
  const minChars = opts.minChars ?? 1200;
  const joined = texts.join("\n");
  const total = chineseLength(joined);
  if (total < minChars) return [];

  const issues: ProseIssue[] = [];
  const per1000 = (n: number): number => Math.round((n / total) * 1000 * 10) / 10;

  // 1) 口头禅密度
  const ticHits: { word: string; sentence: string }[] = [];
  const sentences = sentencesOf(joined);
  for (const s of sentences) {
    for (const w of TICS) {
      if (s.includes(w)) ticHits.push({ word: w, sentence: s });
    }
  }
  const ticRate = per1000(ticHits.length);
  if (ticRate >= 12) {
    const top = new Map<string, number>();
    for (const h of ticHits) top.set(h.word, (top.get(h.word) ?? 0) + 1);
    const worst = [...top.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
    issues.push({
      kind: "套话密度过高",
      message:
        `每千字出现 ${ticRate} 次 AI 口头禅（「${worst.map(([w, n]) => `${w}×${n}`).join("、")}」）。` +
        `这类词几乎总能删掉或换成具体动作：「他不禁缓缓抬起头」→「他抬头，动作比平时慢半拍」。` +
        `写人物状态优先用**他做了什么**，而不是给动词加副词。`,
      samples: ticHits.slice(0, 3).map((h) => h.sentence.slice(0, 60)),
    });
  }

  // 2) 每段都升华
  const upliftHits = sentences.filter((s) => UPLIFT.some((w) => s.includes(w)));
  const upliftRate = per1000(upliftHits.length);
  if (upliftRate >= 6) {
    issues.push({
      kind: "每段都在升华",
      message:
        `每千字有 ${upliftRate} 处「或许这就是…」「在这一刻…」「命运…」式的收束。` +
        `小说里这种句子一章有一次就够了，多了读者会觉得作者不信任自己写的场景。` +
        `把结论删掉，让画面自己说话——读者比你想的会读。`,
      samples: upliftHits.slice(0, 3).map((s) => s.slice(0, 60)),
    });
  }

  // 3) 形容词轰炸
  const bombs = joined.match(ADJ_PILE) ?? [];
  const bombRate = per1000(bombs.length);
  if (bombRate >= 2) {
    issues.push({
      kind: "形容词轰炸",
      message:
        `每千字有 ${bombRate} 处「XX的、XX的、XX的…」式堆叠，读起来像宣传稿。` +
        `一个精确的名词胜过三个形容词：「昏黄的、摇曳的、温暖的灯光」→「四十瓦的灯泡」。`,
      samples: bombs.slice(0, 3),
    });
  }

  // 4) 句子长度过于整齐——人写东西长短句是错落的，模型爱写等长句
  if (sentences.length >= 30) {
    const lens = sentences.map((s) => chineseLength(s));
    const mean = lens.reduce((a, b) => a + b, 0) / lens.length;
    const sd = Math.sqrt(lens.reduce((a, b) => a + (b - mean) ** 2, 0) / lens.length);
    const cv = sd / mean;
    if (cv < 0.42) {
      issues.push({
        kind: "句子长得一样",
        message:
          `句长的离散度只有 ${Math.round(cv * 100) / 100}（平均 ${Math.round(mean)} 字）——` +
          `每句都差不多长，读起来会像念稿。人写东西是长短错落的：` +
          `长句铺陈，然后突然一个三字短句砸下来。有意识地写几个很短的句子。`,
        samples: sentences.slice(0, 3).map((s) => s.slice(0, 60)),
      });
    }
  }

  return issues;
}
