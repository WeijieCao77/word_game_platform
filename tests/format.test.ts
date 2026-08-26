import { describe, it, expect } from "vitest";
import { fmtWan } from "@/lib/format";

/**
 * 这个函数以前三处各写一份，真出过两种错，都是老板亲眼看到的：
 * - 游客额度条把 4000 万写成「4.00 千万」——中文没有这种单位写法
 * - quota 的提示文案在 1000 万就换「亿」，4000 万会写成「4 亿」，差十倍
 * 所以这里把两个出过事的数位钉死，改这个函数前先想想这两条。
 */
describe("fmtWan：中文单位格式化", () => {
  it("一万以下原样给数", () => {
    expect(fmtWan(0)).toBe("0");
    expect(fmtWan(9999)).toBe("9999");
  });

  it("万位：游客 40 万、注册 200 万都要写成人话", () => {
    expect(fmtWan(400_000)).toBe("40 万");
    expect(fmtWan(2_000_000)).toBe("200 万");
    expect(fmtWan(98_000)).toBe("9.8 万");
  });

  it("千万量级仍然用「万」——不许出现「千万」单位，也不许提前换「亿」", () => {
    expect(fmtWan(40_000_000)).toBe("4000 万");
    expect(fmtWan(39_900_000)).toBe("3990 万");
    expect(fmtWan(7_330_000)).toBe("733 万");
  });

  it("满一亿才用「亿」", () => {
    expect(fmtWan(100_000_000)).toBe("1 亿");
    expect(fmtWan(150_000_000)).toBe("1.5 亿");
    expect(fmtWan(123_000_000)).toBe("1.23 亿");
  });
});
