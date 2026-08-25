import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { auditProse } from "@/lib/schema/prose";

// 文笔体检：机检「AI 腔」。
// 恋爱与悬疑类靠文笔立命——玩家要的是「在读小说」的质感。
// 「写得好」没法机检，「写得像 AI」可以。

/** 典型的 AI 腔：套话密集、每段升华、形容词堆叠、句子一样长 */
const AI_FLAVOR = `
她缓缓抬起头，眼底仿佛有一丝不易察觉的情绪在悄然流转。
他不禁微微一怔，心中涌起一阵莫名的暖意，仿佛时间在这一刻静止了。
窗外温柔的、和煦的、明亮的阳光洒进来，空气中弥漫着淡淡的青草香气。
她轻轻地笑了笑，嘴角勾起一抹浅浅的弧度，眸中盛满了细碎的星光。
或许这就是命运的安排，注定要让两个人在这个午后重新相遇。
他深深地看着她，心底涌起久久无法平息的波澜，仿佛所有的等待都有了意义。
她默默地低下头，指尖轻轻摩挲着杯沿，心头掠过一丝说不清的酸涩。
时间仿佛被拉得很长很长，长到足以让所有未说出口的话都渐渐沉淀下来。
在这一刻，他终于明白，有些相遇从一开始就写好了结局。
无论如何，这个下午都将成为他们生命中无法抹去的印记。
`;

/** 人写的：具体名词、动作代替情绪词、长短句错落、不解释 */
const HUMAN = `
她把杯子推过来，杯壁上还有一圈水痕。
"喝吧。"
他没动。桌上那份文件摊着，第三页折了一个角——是她折的，昨天。
"我看过了。"她说。
外面有人在按喇叭，按了三下，停了，又按一下。
他终于伸手，杯子是温的，比他想的温。
"你什么时候看的。"
"昨天夜里。"
她起身去关窗。四十瓦的灯泡在她身后晃了一下，影子从桌面扫过去。
关上窗，喇叭声隔远了。
"我不打算问你为什么。"
他把杯子放下，水面晃了晃，没洒出来。
`;

describe("文笔体检：抓得住 AI 腔", () => {
  const flavored = auditProse([AI_FLAVOR], { minChars: 200 });

  it("套话密集会被点出来，并把原句指给作者", () => {
    const hit = flavored.find((i) => i.kind === "套话密度过高");
    expect(hit).toBeDefined();
    expect(hit!.message).toContain("仿佛");
    expect(hit!.samples.length).toBeGreaterThan(0);
  });

  it("每段都升华会被点出来", () => {
    expect(flavored.some((i) => i.kind === "每段都在升华")).toBe(true);
  });

  it("形容词轰炸会被点出来", () => {
    expect(flavored.some((i) => i.kind === "形容词轰炸")).toBe(true);
  });

  it("人写的东西不该被误伤", () => {
    const clean = auditProse([HUMAN], { minChars: 200 });
    expect(clean.map((i) => i.kind)).toEqual([]);
  });

  it("字数太少不体检——刚起步的作品不该被挑刺", () => {
    expect(auditProse(["她缓缓地仿佛不禁轻轻地一丝莫名"], {})).toEqual([]);
  });
});

describe("现有官方示例离阈值有多远", () => {
  it("八款示例全部通过文笔体检（顺便把数字打出来备查）", () => {
    const dir = path.join(__dirname, "..", "templates");
    const files = readdirSync(dir).filter((f) => f.endsWith(".json") && f !== "library-manifest.json");
    const bad: string[] = [];
    for (const f of files) {
      const c = JSON.parse(readFileSync(path.join(dir, f), "utf8"));
      const texts: string[] = [];
      const push = (t?: string): void => {
        if (t) texts.push(t);
      };
      push(c.meta?.intro);
      push(c.meta?.description);
      for (const card of c.cards ?? []) {
        push(card.text);
        for (const tv of card.textVariants ?? []) push(tv);
        for (const ch of card.choices ?? []) push(ch.text);
      }
      for (const e of c.endings ?? []) push(e.text);
      for (const en of c.search?.entries ?? []) push(en.text);
      const issues = auditProse(texts);
      if (issues.length) bad.push(`${f}: ${issues.map((i) => i.kind).join("、")}`);
    }
    expect(bad).toEqual([]);
  });
});
