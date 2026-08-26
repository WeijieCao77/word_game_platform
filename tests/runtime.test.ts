import { describe, it, expect } from "vitest";
import { runInNewContext } from "node:vm";
import { runtimeAsset, isRuntimeAsset, runtimeVersion } from "../src/lib/runtime";
import { blankCodeIndex } from "../src/lib/blank-code";
import { wrapDataset } from "../src/lib/dataset";

/**
 * 运行库（wgp.js / wgp.css）是平台垫在每一部自由模式作品下面的地基。
 * 它跑在别人的浏览器里、跑在沙箱里，出了错平台这边一点感觉都没有——
 * 所以这份测试盯三件事：
 *   1. 它确实被平台当成虚拟文件供得出来
 *   2. 它自己不许碰沙箱里用不了的东西（否则等于平台带头踩坑）
 *   3. 纯逻辑部分（随机数、DOM 构造、格式化）行为正确
 */

/** 把运行库塞进一个最小的假浏览器里跑起来，拿到它挂出来的 WGP */
function loadRuntime(): {
  WGP: any;
  win: any;
  posted: Array<{ type: string; data?: unknown }>;
  fire: (msg: unknown) => void;
} {
  const posted: Array<{ type: string; data?: unknown }> = [];
  const listeners: Array<(e: { data: unknown }) => void> = [];

  // 假 DOM：只做运行库真正会用到的那几件事
  function makeEl(tag: string): any {
    const node: any = {
      nodeType: 1,
      tagName: tag.toUpperCase(),
      children: [] as any[],
      childNodes: [] as any[],
      style: {},
      dataset: {},
      attrs: {} as Record<string, string>,
      className: "",
      _text: "",
      classList: {
        add() {},
        remove() {},
        toggle() {},
        contains: () => false,
      },
      get textContent(): string {
        if (node.childNodes.length === 0) return node._text;
        return node.childNodes.map((c: any) => c.textContent ?? "").join("");
      },
      set textContent(v: string) {
        node.childNodes = [];
        node.children = [];
        node._text = String(v);
      },
      set innerHTML(v: string) {
        node._text = String(v);
      },
      setAttribute(k: string, v: string) {
        node.attrs[k] = v;
      },
      appendChild(c: any) {
        node.childNodes.push(c);
        if (c.nodeType === 1) node.children.push(c);
        c.parentNode = node;
        return c;
      },
      removeChild(c: any) {
        node.childNodes = node.childNodes.filter((x: any) => x !== c);
        node.children = node.children.filter((x: any) => x !== c);
        return c;
      },
      insertBefore(c: any) {
        node.childNodes.unshift(c);
        node.children.unshift(c);
        return c;
      },
      addEventListener(type: string, fn: () => void) {
        (node._on ||= {})[type] = fn;
      },
      querySelector: () => null,
      get firstChild() {
        return node.childNodes[0] ?? null;
      },
    };
    return node;
  }

  const body = makeEl("body");
  const sandbox: any = {
    console,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    Promise,
    Math,
    Object,
    Array,
    String,
    Number,
    Date,
    JSON,
    document: {
      body,
      createElement: makeEl,
      createTextNode: (t: string) => ({ nodeType: 3, textContent: String(t) }),
      querySelector: () => null,
    },
    parent: {
      postMessage: (m: { type: string; data?: unknown }) => posted.push(m),
    },
  };
  sandbox.window = sandbox;
  sandbox.addEventListener = (type: string, fn: (e: { data: unknown }) => void) => {
    if (type === "message") listeners.push(fn);
  };

  runInNewContext(runtimeAsset("wgp.js")!, sandbox, { filename: "wgp.js" });
  return {
    WGP: sandbox.WGP,
    win: sandbox,
    posted,
    fire: (data: unknown) => listeners.forEach((fn) => fn({ data })),
  };
}

describe("运行库供得出来", () => {
  it("wgp.js / wgp.css 是虚拟文件，别的路径不是", () => {
    expect(isRuntimeAsset("wgp.js")).toBe(true);
    expect(isRuntimeAsset("wgp.css")).toBe(true);
    expect(isRuntimeAsset("game.js")).toBe(false);
    expect(runtimeAsset("game.js")).toBeNull();
    expect(runtimeAsset("wgp.js")!.length).toBeGreaterThan(3000);
    expect(runtimeAsset("wgp.css")!.length).toBeGreaterThan(1000);
  });

  it("有版本号，能报给技能包和文件页签", () => {
    expect(runtimeVersion()).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("自己不碰沙箱里用不了的东西", () => {
    const src = runtimeAsset("wgp.js")!;
    for (const banned of ["localStorage", "sessionStorage", "indexedDB", "document.cookie", "XMLHttpRequest", "WebSocket"]) {
      expect(src.includes(banned)).toBe(false);
    }
    // fetch / eval 同理：只允许出现在注释里说明「不能用」，代码里不许有调用形式
    expect(/\bfetch\s*\(/.test(src)).toBe(false);
    expect(/\beval\s*\(/.test(src)).toBe(false);
  });

  it("皮肤里定义了技能包答应给作者的那几个变量", () => {
    const css = runtimeAsset("wgp.css")!;
    for (const v of ["--wgp-bg", "--wgp-panel", "--wgp-line", "--wgp-ink", "--wgp-dim", "--wgp-accent", "--wgp-ok", "--wgp-warn", "--wgp-bad"]) {
      expect(css).toContain(v + ":");
    }
    // 手机上左右乱晃是自由模式最常见的毛病，样式里要从根上掐掉
    expect(css).toContain("overflow-x: hidden");
  });
});

describe("运行库跑得起来", () => {
  it("挂出完整的 API 面（技能包里写了什么，这里就得有什么）", () => {
    const { WGP } = loadRuntime();
    for (const k of ["ready", "save", "saveLater", "clearSave", "rng", "el", "mount", "screen", "go", "back", "refresh", "current", "nav", "ui", "text", "data", "fmt", "wait"]) {
      expect(typeof (WGP as any)[k]).not.toBe("undefined");
    }
    for (const k of ["panel", "stat", "stats", "bar", "table", "actions", "modal", "confirm", "toast"]) {
      expect(typeof WGP.ui[k]).toBe("function");
    }
  });

  it("起手就跟外壳握手：ready + load 两句都发出去", () => {
    const { posted } = loadRuntime();
    expect(posted.map((m) => m.type)).toEqual(["wgp:ready", "wgp:load"]);
  });

  it("存档取回来才开工，取回的东西原样交给回调", () => {
    const { WGP, fire } = loadRuntime();
    let got: unknown = "没调过";
    WGP.ready((d: unknown) => {
      got = d;
    });
    expect(got).toBe("没调过");
    fire({ type: "wgp:loaded", data: { taps: 3 } });
    expect(got).toEqual({ taps: 3 });
  });

  it("外壳只回一次：重复的 loaded 不会把游戏重开一遍", () => {
    const { WGP, fire } = loadRuntime();
    let times = 0;
    WGP.ready(() => {
      times += 1;
    });
    fire({ type: "wgp:loaded", data: null });
    fire({ type: "wgp:loaded", data: { a: 1 } });
    expect(times).toBe(1);
  });

  it("save 发的是 wgp:save，clearSave 发的是 wgp:clear", () => {
    const { WGP, posted } = loadRuntime();
    WGP.save({ hp: 9 });
    WGP.clearSave();
    expect(posted.slice(2)).toEqual([{ type: "wgp:save", data: { hp: 9 } }, { type: "wgp:clear" }]);
  });
});

describe("随机数可复现", () => {
  it("同一个种子跑出同一串数", () => {
    const { WGP } = loadRuntime();
    const a = WGP.rng(20260826);
    const b = WGP.rng(20260826);
    const seqA = Array.from({ length: 20 }, () => a.float());
    const seqB = Array.from({ length: 20 }, () => b.float());
    expect(seqA).toEqual(seqB);
  });

  it("换个种子就是另一串", () => {
    const { WGP } = loadRuntime();
    const a = Array.from({ length: 20 }, () => WGP.rng(1).float());
    const b = Array.from({ length: 20 }, () => WGP.rng(2).float());
    expect(a).not.toEqual(b);
  });

  it("字符串种子也接得住", () => {
    const { WGP } = loadRuntime();
    expect(WGP.rng("赛季一").float()).toBe(WGP.rng("赛季一").float());
    expect(WGP.rng("赛季一").float()).not.toBe(WGP.rng("赛季二").float());
  });

  it("seed 存得下、读得回，接着摇结果一致", () => {
    const { WGP } = loadRuntime();
    const r = WGP.rng(7);
    r.int(1, 100);
    r.int(1, 100);
    const saved = r.seed; // 存档里存的就是这个
    const rest = [r.int(1, 100), r.int(1, 100), r.int(1, 100)];
    const resumed = WGP.rng(saved);
    expect([resumed.int(1, 100), resumed.int(1, 100), resumed.int(1, 100)]).toEqual(rest);
  });

  it("int 落在闭区间里，chance 概率对得上", () => {
    const { WGP } = loadRuntime();
    const r = WGP.rng(42);
    const seen = new Set<number>();
    for (let i = 0; i < 2000; i++) {
      const n = r.int(1, 6);
      expect(n).toBeGreaterThanOrEqual(1);
      expect(n).toBeLessThanOrEqual(6);
      seen.add(n);
    }
    expect(seen.size).toBe(6);

    let hit = 0;
    for (let i = 0; i < 4000; i++) if (r.chance(0.25)) hit += 1;
    expect(hit / 4000).toBeGreaterThan(0.2);
    expect(hit / 4000).toBeLessThan(0.3);
  });

  it("shuffle 不吞元素也不动原数组，weighted 认权重", () => {
    const { WGP } = loadRuntime();
    const r = WGP.rng(5);
    const src = [1, 2, 3, 4, 5, 6, 7, 8];
    const out = r.shuffle(src);
    expect(out.slice().sort((a: number, b: number) => a - b)).toEqual(src);
    expect(src).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);

    const pool = [{ id: "常见", weight: 95 }, { id: "稀有", weight: 5 }];
    let rare = 0;
    for (let i = 0; i < 3000; i++) if (r.weighted(pool).id === "稀有") rare += 1;
    expect(rare).toBeGreaterThan(60);
    expect(rare).toBeLessThan(300);
  });
});

describe("DOM 构造与格式化", () => {
  it("el 用 textContent 落字，玩家起的名字里带尖括号也拆不了界面", () => {
    const { WGP } = loadRuntime();
    const node = WGP.el("div", { class: "x", text: "<script>坏事</script>" });
    expect(node.tagName).toBe("DIV");
    expect(node.className).toBe("x");
    expect(node.textContent).toBe("<script>坏事</script>");
  });

  it("el 接得住子节点数组、跳过 null，第二个参数直接传子节点也认", () => {
    const { WGP } = loadRuntime();
    const node = WGP.el("ul", {}, [WGP.el("li", { text: "甲" }), null, false, WGP.el("li", { text: "乙" })]);
    expect(node.children.length).toBe(2);
    const shorthand = WGP.el("p", "只有一句话");
    expect(shorthand.textContent).toBe("只有一句话");
  });

  it("onClick 挂成事件，不是写成属性", () => {
    const { WGP } = loadRuntime();
    let clicked = 0;
    const btn = WGP.el("button", { onClick: () => (clicked += 1) });
    expect(typeof btn._on.click).toBe("function");
    btn._on.click();
    expect(clicked).toBe(1);
    expect(btn.attrs.onClick).toBeUndefined();
  });

  it("fmt 把数字排成人看的样子", () => {
    const { WGP } = loadRuntime();
    expect(WGP.fmt.num(1234567)).toBe("1,234,567");
    expect(WGP.fmt.num(999)).toBe("999");
    expect(WGP.fmt.pct(0.4237, 1)).toBe("42.4%");
    expect(WGP.fmt.money(1200, "¥")).toBe("¥1,200");
    expect(WGP.fmt.clamp(120, 0, 100)).toBe(100);
  });
});

describe("数据表", () => {
  it("WGP.data 取的是孪生 js 挂上来的那张表", () => {
    const { WGP, win } = loadRuntime();
    const js = wrapDataset("roster", "data/roster.csv", "name,rating\nTenZ,92\n");
    // 孪生 js 是用 <script src> 引进来的，效果等同于在同一个 window 上执行
    new Function("window", "console", js)(win, console);
    expect(WGP.data("roster")).toEqual([{ name: "TenZ", rating: 92 }]);
  });

  it("表没引进来时给空数组，并在控制台说清该怎么补", () => {
    const { WGP } = loadRuntime();
    const errs: string[] = [];
    const orig = console.error;
    console.error = (m: string) => errs.push(String(m));
    try {
      expect(WGP.data("没这张表")).toEqual([]);
    } finally {
      console.error = orig;
    }
    expect(errs.join("")).toContain("data/没这张表.csv");
  });
});

describe("起手页就用运行库", () => {
  it("引了 wgp.css / wgp.js，示范了正确的存档写法", () => {
    const html = blankCodeIndex("测试作品");
    expect(html).toContain('href="wgp.css"');
    expect(html).toContain('src="wgp.js"');
    expect(html).toContain("WGP.ready(");
    expect(html).toContain("WGP.save(");
  });

  it("不示范沙箱里用不了的东西", () => {
    const html = blankCodeIndex("测试作品");
    for (const banned of ["localStorage", "sessionStorage", "document.cookie"]) {
      expect(html.includes(banned)).toBe(false);
    }
  });

  it("仍然小于实测脚本判「只剩起手页」的那条线（3000 字符）", () => {
    expect(blankCodeIndex("测试作品").length).toBeLessThan(3000);
  });
});
