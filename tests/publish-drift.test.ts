import { describe, it, expect } from "vitest";
import { comparePublished, describeDrift } from "@/lib/publish-drift";

/**
 * 实测第 5 次真实发生的一幕，一比一还原：
 *
 *   冒烟检查报「ng2 崩了」→ AI 修 → 再玩一遍报错一模一样 → 再修 → 还是一模一样
 *   → 第三轮 AI 判定「这是旧记录，行号对不上当前文件」，不改了。
 *
 * 它的观察对（行号确实对不上），推论错：不是记录旧，是**玩家在玩的那份代码旧**。
 * 发布只做过一次，之后三轮补丁全落在草稿上。三轮、八十万 token 全白烧。
 */
describe("草稿与线上快照的落差要说出来", () => {
  it("改了没发布 → 点破「玩家跑的不是你刚写的代码」", () => {
    const d = comparePublished(
      { "index.html": "<html>新</html>", "game.js": "修好了" },
      { "index.html": "<html>新</html>", "game.js": "还没修" }
    );
    expect(d.changed).toEqual(["game.js"]);
    const say = describeDrift(d);
    expect(say).toContain("game.js");
    expect(say).toContain("旧版本");
    expect(say).toContain("发布");
  });

  it("一模一样就闭嘴——别拿噪音去烦 AI", () => {
    const same = { "a.js": "x", "b.css": "y" };
    expect(describeDrift(comparePublished(same, { ...same }))).toBe("");
  });

  it("还没发布过就不提——那不是落差，是还没上线", () => {
    const d = comparePublished({ "a.js": "x" }, null);
    expect(d.published).toBe(false);
    expect(describeDrift(d)).toBe("");
  });

  it("新加的文件算落差", () => {
    const d = comparePublished({ "a.js": "x", "新加的.js": "y" }, { "a.js": "x" });
    expect(d.changed).toEqual(["新加的.js"]);
  });

  it("删掉的文件也算，而且要标出来", () => {
    const d = comparePublished({ "a.js": "x" }, { "a.js": "x", "废弃.js": "z" });
    expect(d.removed).toEqual(["废弃.js"]);
    expect(describeDrift(d)).toContain("废弃.js（已删）");
  });

  it("落差很多时只列前几个，不要刷屏", () => {
    const draft: Record<string, string> = {};
    const live: Record<string, string> = {};
    for (let i = 0; i < 20; i++) {
      draft[`f${i}.js`] = "新";
      live[`f${i}.js`] = "旧";
    }
    const say = describeDrift(comparePublished(draft, live));
    expect(say).toContain("有 20 个文件");
    expect(say).toContain("等");
  });
});
