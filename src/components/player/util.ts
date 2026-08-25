import { GameConfig } from "@/lib/schema";

// 播放器公用小工具：存档键、配置指纹、素材地址、数字格式化。
// 只放无状态的纯函数——有状态的逻辑放 hooks.ts。

export const KIND_LABEL: Record<string, string> = {
  victory: "结局 · 达成",
  defeat: "结局 · 落幕",
  neutral: "结局",
};

export function saveKey(gameId: string): string {
  return `wgp_save_${gameId}`;
}

/** 配置指纹：游戏更新后能识别出旧存档 */
export function configHash(config: GameConfig): number {
  const s = JSON.stringify(config);
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

/** 卡片/档案里的图片引用 → 可访问的地址（外链直接用，素材名走本游戏的素材接口） */
export function assetUrlOf(gameId: string | undefined, ref: string): string {
  if (/^https?:\/\//.test(ref)) return ref;
  return gameId ? `/api/games/${gameId}/assets/${encodeURIComponent(ref)}` : "";
}

export function formatNum(n: number): string {
  return Number.isInteger(n) ? String(n) : (Math.round(n * 10) / 10).toString();
}
