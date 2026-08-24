// 无美术资产的「封面」：按游戏 id 确定性取渐变配色 + 品类图标 + 标题排版。
// 商店感的最低成本实现；将来支持作者上传封面时此组件作为兜底。

const PALETTES: [string, string][] = [
  ["#1e3a8a", "#7c3aed"],
  ["#0f766e", "#4d7c0f"],
  ["#9d174d", "#b45309"],
  ["#312e81", "#0369a1"],
  ["#7f1d1d", "#c2410c"],
  ["#14532d", "#0e7490"],
  ["#581c87", "#be185d"],
  ["#0c4a6e", "#047857"],
];

const KIND_ICON: Record<string, string> = {
  sim: "🏆",
  life: "🎲",
  story: "📖",
  unknown: "🎮",
  flagship: "⭐",
};

function hashOf(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

export default function GameCover({
  id,
  title,
  kind,
  wide,
}: {
  id: string;
  title: string;
  kind: string;
  wide?: boolean;
}): React.ReactElement {
  const [a, b] = PALETTES[hashOf(id) % PALETTES.length];
  return (
    <div
      className={`cover ${wide ? "cover-wide" : ""}`}
      style={{ background: `linear-gradient(135deg, ${a} 0%, ${b} 100%)` }}
    >
      <span className="cover-icon" aria-hidden>
        {KIND_ICON[kind] ?? KIND_ICON.unknown}
      </span>
      <span className="cover-title">{title}</span>
    </div>
  );
}
