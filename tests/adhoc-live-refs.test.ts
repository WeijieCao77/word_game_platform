import { describe, expect, it } from "vitest";
import { checkMissingRefs, describeMissingRefs } from "@/lib/js-refs";
import { checkWiring, describeWiring } from "@/lib/wiring";

// 线上作品的接线体检：
//   LIVE_BASE=https://… LIVE_GAME=2ena8oju npx vitest run tests/adhoc-live-refs.test.ts
//
// 为什么要有这个：这两层护栏（接线体检 + 缺失引用体检）是照着线上真死掉的作品写的，
// 那就得拿那部作品去验——本地编几个用例说明不了它在真代码上会不会误报。
// 不设环境变量时自动跳过，不影响 CI。容器出口够不到线上，所以这条在 runner 上跑。

const base = process.env.LIVE_BASE;
const game = process.env.LIVE_GAME;

describe.skipIf(!base || !game)(`线上作品接线体检：${game}`, () => {
  it("把作品的代码抓下来，报接线问题与缺失引用", { timeout: 120000 }, async () => {
    const get = async (p: string): Promise<string> => {
      const r = await fetch(`${base}/play/${game}/${p}`);
      return r.ok ? await r.text() : "";
    };
    const index = await get("index.html");
    expect(index, "取不到 index.html（作品没发布？）").not.toBe("");

    const files: Record<string, string> = { "index.html": index };
    const refs = new Set<string>();
    const re = /<(?:script|link)\b[^>]*?\b(?:src|href)\s*=\s*("|')([^"']+)\1/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(index))) {
      const src = m[2];
      if (/^(https?:)?\/\//i.test(src) || /^(data|blob):/i.test(src)) continue;
      if (/^\/?wgp\//i.test(src)) continue;
      refs.add(src.replace(/^\.?\//, "").split(/[?#]/)[0]);
    }
    for (const p of refs) {
      const body = await get(p);
      if (body) files[p] = body;
    }

    const sizes = Object.entries(files).map(([p, c]) => `${p} ${c.length} 字符`);
    console.log(`\n【抓到的文件】\n${sizes.join("\n")}`);

    const wiring = describeWiring(checkWiring(files));
    console.log(`\n【接线体检】\n${wiring || "没发现问题"}`);

    const missing = checkMissingRefs(files);
    console.log(`\n【缺失引用体检】\n${describeMissingRefs(missing) || "没发现问题"}`);
    // 只报告不断言——这是一条给人看的诊断，不是 CI 门槛
    expect(Object.keys(files).length).toBeGreaterThan(0);
  });
});
