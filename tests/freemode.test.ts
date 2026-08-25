import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { SqliteGameStore } from "@/lib/store/sqlite";
import { buildSystemPrompt, pickSkills } from "@/lib/ai/prompt";
import { makePreviewToken, checkPreviewToken } from "@/lib/preview-token";
import { GameConfig } from "@/lib/schema";

// 自由模式：作品自带一套网页文件，跑在沙箱 iframe 里。
// 这一组测试守两件事：① 文件存储与形态切换的行为；
// ② 示范作品确实没碰沙箱里用不了的东西（写了就白屏，测试要比玩家先发现）。

const MINI = {
  schemaVersion: 1,
  meta: { title: "自由模式测试" },
  driver: { kind: "story", startCard: "c1" },
  vars: [],
  cards: [{ id: "c1", text: "……" }],
  endings: [],
};

function newStore(): SqliteGameStore {
  const dir = mkdtempSync(path.join(tmpdir(), "wgp-free-"));
  return new SqliteGameStore(path.join(dir, "test.db"));
}

describe("自由模式的文件存储", () => {
  it("新作品默认是快速模式，写文件后才切到自由模式", () => {
    const store = newStore();
    const { id } = store.create({ config: MINI });
    expect(store.gameMode(id)).toBe("engine");
    expect(store.fileList(id)).toEqual([]);

    store.fileWrite(id, "index.html", "<h1>hi</h1>");
    store.gameSetMode(id, "code");
    expect(store.gameMode(id)).toBe("code");
    expect(store.fileList(id).map((f) => f.path)).toEqual(["index.html"]);
  });

  it("写同一个路径是覆盖而不是追加，删掉后读回 null", () => {
    const store = newStore();
    const { id } = store.create({ config: MINI });
    store.fileWrite(id, "game.js", "var a = 1;");
    store.fileWrite(id, "game.js", "var a = 2;");
    expect(store.fileList(id)).toHaveLength(1);
    expect(store.fileRead(id, "game.js")).toBe("var a = 2;");

    store.fileDelete(id, "game.js");
    expect(store.fileRead(id, "game.js")).toBeNull();
    expect(store.fileList(id)).toEqual([]);
  });

  it("文件是按作品隔离的：另一部作品读不到", () => {
    const store = newStore();
    const a = store.create({ config: MINI });
    const b = store.create({ config: MINI });
    store.fileWrite(a.id, "index.html", "A 的页面");
    expect(store.fileRead(b.id, "index.html")).toBeNull();
  });

  it("重开连接（换一个 store 实例）文件还在——落的是盘不是内存", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "wgp-free-"));
    const dbPath = path.join(dir, "test.db");
    const store = new SqliteGameStore(dbPath);
    const { id } = store.create({ config: MINI });
    store.fileWrite(id, "index.html", "<p>存住</p>");
    store.gameSetMode(id, "code");

    const reopened = new SqliteGameStore(dbPath);
    expect(reopened.gameMode(id)).toBe("code");
    expect(reopened.fileRead(id, "index.html")).toBe("<p>存住</p>");
  });

  it("删掉作品时文件跟着走，不留孤儿", () => {
    const store = newStore();
    const { id } = store.create({ config: MINI });
    store.fileWrite(id, "index.html", "x");
    store.delete(id);
    expect(store.fileList(id)).toEqual([]);
  });
});

describe("自由模式下发给 AI 的守则", () => {
  const cfg = MINI as unknown as GameConfig;

  it("code 模式必发「自由模式」技能包，且不发引擎那几包", () => {
    const picked = pickSkills(cfg, "code");
    expect(picked).toContain("自由模式");
    expect(picked).not.toContain("经营模块");
    expect(picked).not.toContain("淘汰赛");
  });

  it("code 模式的核心里不再说「不能定制界面」，而是说界面归你写", () => {
    const engine = buildSystemPrompt(cfg, "engine");
    const code = buildSystemPrompt(cfg, "code");
    expect(engine).toContain("平台目前不能定制界面外观");
    expect(code).not.toContain("平台目前不能定制界面外观");
    expect(code).toContain("界面由你写");
  });

  it("engine 模式要告诉创作者自由模式这条路存在（不然只会说做不到）", () => {
    expect(buildSystemPrompt(cfg, "engine")).toContain("自由模式");
  });

  it("code 模式省掉了引擎配置那一大段，提示明显更短", () => {
    const engine = buildSystemPrompt(cfg, "engine");
    const code = buildSystemPrompt(cfg, "code");
    expect(code.length).toBeLessThan(engine.length);
  });
});

describe("示范作品《末班车守夜人》", () => {
  const dir = path.join(process.cwd(), "templates", "freemode-demo");
  const html = readFileSync(path.join(dir, "index.html"), "utf-8");
  const js = readFileSync(path.join(dir, "game.js"), "utf-8");
  const css = readFileSync(path.join(dir, "style.css"), "utf-8");

  it("入口叫 index.html，并且引用的文件都在", () => {
    expect(html).toContain("game.js");
    expect(html).toContain("style.css");
    expect(js.length).toBeGreaterThan(1000);
    expect(css.length).toBeGreaterThan(500);
  });

  it("没碰沙箱里用不了的东西：存储、网络、开窗", () => {
    // 只看真代码：注释里提到 localStorage 是在解释「为什么不能用」，不算违规
    const strip = (t: string): string => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    const code = strip(js) + strip(html);
    for (const banned of ["localStorage", "sessionStorage", "document.cookie", "indexedDB", "fetch(", "XMLHttpRequest", "WebSocket", "window.open"]) {
      expect(code.includes(banned), `示范作品不该出现 ${banned}`).toBe(false);
    }
  });

  it("存档走 postMessage，并且起来会吱一声", () => {
    expect(js).toContain('type: "wgp:ready"');
    expect(js).toContain('type: "wgp:save"');
    expect(js).toContain('type: "wgp:load"');
    expect(js).toContain("wgp:loaded");
  });

  it("手机上能看：有 viewport，也有窄屏的排版分支", () => {
    expect(html).toContain("viewport");
    expect(css).toContain("@media");
  });

  it("每个结局都够得着——从开场沿选项走，四个结局都能到", () => {
    // 把 game.js 里的场景表捞出来做可达性检查（不 eval 整份文件，只取 SCENES 的结构）
    const ids = [...js.matchAll(/^  (\w+): \{/gm)].map((m) => m[1]);
    const gotos = new Set([...js.matchAll(/to: "(\w+)"/g)].map((m) => m[1]));
    const endings = ids.filter((i) => i.startsWith("end"));
    expect(endings.length).toBeGreaterThanOrEqual(4);
    for (const e of endings) expect(gotos.has(e), `${e} 没有任何选项通向它`).toBe(true);
    // 反过来：每个 to 都要有对应的场景，别有断链
    for (const g of gotos) expect(ids.includes(g), `选项指向不存在的场景 ${g}`).toBe(true);
  });
});

describe("未发布作品的预览通行证", () => {
  // 这一组守的是一个真实翻车：多文件作品在工作台里预览，index.html 能开，
  // style.css / game.js 全 403 —— 作者看到一张裸页，还以为 AI 把代码写坏了。
  // 根因是浏览器发子请求时不带查询串；换 cookie 也不行，沙箱 iframe 是不透明源，
  // 它发的子请求算「跨站」，SameSite=Lax 的 cookie 不会带上。
  // 所以通行证放进路径，让相对引用自然继承。
  const KEY = "edit-key-abcdef";

  it("同一把钥匙推出来的通行证能过，别的钥匙不行", () => {
    const t = makePreviewToken(KEY);
    expect(checkPreviewToken(KEY, t)).toBe(true);
    expect(checkPreviewToken("另一把钥匙", t)).toBe(false);
  });

  it("通行证不等于钥匙——看不出原文", () => {
    const t = makePreviewToken(KEY);
    expect(t).not.toContain(KEY);
    expect(t).toMatch(/^[0-9a-f]{32}$/);
  });

  it("上一个时间窗的通行证还认（别在半小时边界上把作者踢下去）", () => {
    const now = 1_800_000_000_000;
    const old = makePreviewToken(KEY, now - 25 * 60 * 1000);
    expect(checkPreviewToken(KEY, old, now)).toBe(true);
  });

  it("再往前就不认了", () => {
    const now = 1_800_000_000_000;
    const ancient = makePreviewToken(KEY, now - 3 * 60 * 60 * 1000);
    expect(checkPreviewToken(KEY, ancient, now)).toBe(false);
  });

  it("乱填的通行证一律不认", () => {
    for (const junk of ["", "abc", "../../etc/passwd", "Z".repeat(32), "0".repeat(64)]) {
      expect(checkPreviewToken(KEY, junk)).toBe(false);
    }
  });

  it("存储层：通行证按作品隔离，A 的过不了 B", () => {
    const store = newStore();
    const a = store.create({ config: MINI });
    const b = store.create({ config: MINI });
    const ta = store.previewToken(a.id)!;
    expect(store.checkPreviewToken(a.id, ta)).toBe(true);
    expect(store.checkPreviewToken(b.id, ta)).toBe(false);
  });
});
