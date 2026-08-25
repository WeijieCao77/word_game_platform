import Link from "next/link";
import FlagshipFrame from "@/components/FlagshipFrame";

export const dynamic = "force-dynamic";

const TITLE = "VAL MANAGER · 无畏契约电竞经理";
// 旗舰作品由点点独立制作，与官方示例区分开；部署时可用 FLAGSHIP_AUTHOR 覆盖
const AUTHOR = process.env.FLAGSHIP_AUTHOR || "点点";

/**
 * 探测目标站是否明确拒绝被嵌入（X-Frame-Options / CSP frame-ancestors）。
 * 探测本身失败（超时、网络不通）按「允许」处理，由前端兜底提示。
 */
async function embedRefused(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(4000) });
    const xfo = (res.headers.get("x-frame-options") ?? "").toLowerCase();
    if (xfo.includes("deny") || xfo.includes("sameorigin")) return true;
    const csp = (res.headers.get("content-security-policy") ?? "").toLowerCase();
    return /frame-ancestors[^;]*'none'/.test(csp);
  } catch {
    return false;
  }
}

export default async function FlagshipPage(): Promise<React.ReactElement> {
  const url = process.env.FLAGSHIP_URL;
  if (!url) {
    return (
      <div className="site" style={{ maxWidth: 520 }}>
        <h1 style={{ fontSize: 22, marginBottom: 10 }}>旗舰作品未配置</h1>
        <p style={{ color: "var(--muted)", marginBottom: 16 }}>
          部署环境变量里还没有 FLAGSHIP_URL，旗舰位暂不可用。
        </p>
        <Link className="btn" href="/">
          返回游戏库
        </Link>
      </div>
    );
  }

  if (await embedRefused(url)) {
    return (
      <div className="site" style={{ maxWidth: 560 }}>
        <h1 style={{ fontSize: 22, marginBottom: 10 }}>{TITLE}</h1>
        <p style={{ color: "var(--muted)", marginBottom: 6 }}>作者：{AUTHOR}</p>
        <p style={{ color: "var(--muted)", marginBottom: 16 }}>
          该站点设置了禁止嵌入，只能在新窗口打开游玩。
        </p>
        <div className="hero-actions">
          <a className="btn" href={url} target="_blank" rel="noreferrer">
            打开游戏 ↗
          </a>
          <Link className="btn secondary" href="/">
            返回游戏库
          </Link>
        </div>
      </div>
    );
  }

  return <FlagshipFrame url={url} title={TITLE} author={AUTHOR} />;
}
