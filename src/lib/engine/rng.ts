// 确定性随机数（mulberry32）。种子存在 GameState 里，
// 同一份配置 + 同一个种子 + 同样的操作序列 => 完全相同的过程，便于回放与测试。

export interface Rng {
  next(): number; // [0, 1)
  int(lo: number, hi: number): number; // 闭区间
  state(): number;
}

/**
 * mulberry32 的完整内部状态就是一个 32 位整数：
 * createRng(seed) 开新流，createRng(state()) 从保存点精确续流。
 */
export function createRng(seed: number): Rng {
  let s = seed >>> 0;
  const next = (): number => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int(lo: number, hi: number): number {
      const a = Math.ceil(Math.min(lo, hi));
      const b = Math.floor(Math.max(lo, hi));
      return a + Math.floor(next() * (b - a + 1));
    },
    state: () => s,
  };
}
