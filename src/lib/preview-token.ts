import { createHash } from "node:crypto";

/**
 * 未发布作品的预览通行证。
 *
 * 为什么不用 ?k= 也不用 cookie，两条路都试过、都不行：
 *
 * - **?k=**：index.html 里 `<link href="style.css">` 这种相对引用，浏览器发子请求时
 *   不会带查询串，于是主页面能开、样式和脚本全 403，作者看到一张裸页。
 * - **cookie**：自由模式的 iframe 是 sandbox 且没有 allow-same-origin，文档拿到的是
 *   **不透明源**；它发出的子资源请求在 cookie 的口径里算「跨站」，SameSite=Lax 不会带。
 *   （实测过：index.html 那次顶层导航带得上，style.css / game.js 一律 403。）
 *
 * 所以把通行证放进**路径**：/play/:id/k~<token>/index.html，
 * 相对引用自然落到 /play/:id/k~<token>/style.css，一条也不漏。
 *
 * token 由编辑钥匙推出来，半小时一换（校验时接受当前与上一个窗口，避免边界上翻车）。
 * 它不等于钥匙——泄露了也改不了作品，只能读这一部作品自己的文件，
 * 而那些文件正是这个 iframe 里跑着的东西。
 */

const WINDOW_MS = 30 * 60 * 1000;

function tokenAt(editKey: string, windowIndex: number): string {
  return createHash("sha256").update(`wgp-preview:${editKey}:${windowIndex}`).digest("hex").slice(0, 32);
}

export function makePreviewToken(editKey: string, now = Date.now()): string {
  return tokenAt(editKey, Math.floor(now / WINDOW_MS));
}

export function checkPreviewToken(editKey: string, token: string, now = Date.now()): boolean {
  if (!editKey || !token || !/^[0-9a-f]{32}$/.test(token)) return false;
  const w = Math.floor(now / WINDOW_MS);
  return token === tokenAt(editKey, w) || token === tokenAt(editKey, w - 1);
}
