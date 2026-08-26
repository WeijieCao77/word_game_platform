import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * 自由模式的运行库：平台替作品垫在下面的那一层。
 *
 * 作品跑在沙箱 iframe 里，每部作品都要重新解决同一批问题——存档只能走 postMessage、
 * 界面要自己切、随机数要可复现、表格进度条要自己画。让 AI 每次从零写这些，
 * 既烧 token 又容易踩同样的坑（localStorage 读不到、fetch 被 CSP 掐死）。
 *
 * 所以平台在 /play/:id/ 下**虚拟出**两个文件：
 *   wgp.js   运行库
 *   wgp.css  配套皮肤
 * 作品里一行 <script src="wgp.js"> 就有了，不必自带、也不占作品的文件数。
 *
 * 作者要是自己写了同名文件，以作者的为准（见 play 路由：先查作品文件，再兜底到这里）。
 */

/** 虚拟文件名 → public 下的真身 */
const ASSETS: Record<string, string> = {
  "wgp.js": "public/wgp/runtime.js",
  "wgp.css": "public/wgp/style.css",
};

const cache = new Map<string, string>();

/** 这条路径是不是运行库的虚拟文件 */
export function isRuntimeAsset(path: string): boolean {
  return Object.prototype.hasOwnProperty.call(ASSETS, path);
}

/** 取运行库文件内容；不是运行库路径、或文件读不到都返回 null */
export function runtimeAsset(path: string): string | null {
  const rel = ASSETS[path];
  if (!rel) return null;
  const hit = cache.get(path);
  if (hit !== undefined) return hit;
  try {
    const text = readFileSync(join(process.cwd(), rel), "utf8");
    cache.set(path, text);
    return text;
  } catch {
    // 读不到不该把整部作品带崩——当成没有这个文件，作品自己带的那份照样能跑
    return null;
  }
}

/** 运行库的版本号，从源码里抠出来；给技能包和文件页签显示用 */
export function runtimeVersion(): string {
  const src = runtimeAsset("wgp.js") ?? "";
  return /var VERSION = "([^"]+)"/.exec(src)?.[1] ?? "0";
}
