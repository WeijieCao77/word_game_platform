import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { validateGameConfig } from "@/lib/schema";
import { simulate, summarizeReport } from "@/lib/simulate";

// 临时模板体检：TEMPLATE=xxx.json npx vitest run tests/adhoc-template.test.ts
// 内容作者（人或 AI）改模板时的快速反馈回路；不设 TEMPLATE 时自动跳过，不影响 CI。

const file = process.env.TEMPLATE;

describe.skipIf(!file)(`模板体检：${file}`, () => {
  it("三级校验零错误零警告 + 模拟 600 局全覆盖且无开局即死", { timeout: 120000 }, () => {
    const config = JSON.parse(readFileSync(path.join(__dirname, "..", "templates", file!), "utf8"));
    const check = validateGameConfig(config);
    const errors = check.issues.filter((i) => i.severity === "error");
    const warnings = check.issues.filter((i) => i.severity !== "error");
    expect(errors.map((i) => `${i.path}: ${i.message}`)).toEqual([]);
    expect(warnings.map((i) => `${i.path}: ${i.message}`)).toEqual([]);

    const report = simulate(check.config!, 600, 20260824);
    console.log("\n" + summarizeReport(report));
    expect(report.errors).toEqual([]);
    expect(report.endings["__unfinished__"]).toBeUndefined();
    expect(report.unreachedEndings, "有结局从未触发").toEqual([]);
    expect(report.earlyEndRate, "开局即死率超标").toBeLessThanOrEqual(0.03);
  });
});
