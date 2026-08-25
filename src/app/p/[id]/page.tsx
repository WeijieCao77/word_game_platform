import Link from "next/link";
import { getStore } from "@/lib/store";
import CodeGameFrame from "@/components/CodeGameFrame";
import { GameConfig } from "@/lib/schema";

export const dynamic = "force-dynamic";

/**
 * 自由模式作品的游玩页。
 *
 * 快速模式在 /g/:id（配置喂给通用引擎渲染），自由模式在这里——
 * 作品自带的一套页面跑在沙箱 iframe 里，长什么样由作者说了算。
 */
export default async function CodeGamePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ k?: string }>;
}): Promise<React.ReactElement> {
  const { id } = await params;
  const { k } = await searchParams;
  const store = getStore();
  const record = store.get(id);

  if (!record || store.gameMode(id) !== "code") {
    return (
      <div className="site" style={{ maxWidth: 520 }}>
        <h1 style={{ fontSize: 22, marginBottom: 10 }}>这里没有这部作品</h1>
        <p style={{ color: "var(--muted)", marginBottom: 16 }}>
          它可能还没发布，或者是「快速模式」的作品——那种在 <code>/g/{id}</code>。
        </p>
        <Link className="btn" href="/">
          返回游戏库
        </Link>
      </div>
    );
  }

  const hasIndex = store.fileRead(id, "index.html") !== null;
  if (!hasIndex) {
    return (
      <div className="site" style={{ maxWidth: 520 }}>
        <h1 style={{ fontSize: 22, marginBottom: 10 }}>这部作品还没有页面</h1>
        <p style={{ color: "var(--muted)", marginBottom: 16 }}>
          自由模式的作品至少要有一个 <code>index.html</code>。回工作台让 AI 把它写出来。
        </p>
        <Link className="btn" href={`/edit/${id}`}>
          去工作台
        </Link>
      </div>
    );
  }

  const title = (record.config as GameConfig)?.meta?.title ?? "无题";
  return <CodeGameFrame gameId={id} title={title} editKey={record.published ? undefined : k} />;
}
