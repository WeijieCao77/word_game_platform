import { GameState } from "@/lib/schema";
import { assetUrlOf } from "./util";

// 叙事流：游戏产生的每条文字（和作者给这条配的图）。
// life/story 全量展示，sim 在总览页只显示最近几条。

type Entry = GameState["log"][number];

export function LogEntryView({ entry, gameId }: { entry: Entry; gameId?: string }): React.ReactElement {
  const img = entry.image ? assetUrlOf(gameId, entry.image) : "";
  return (
    <div className={`log-${entry.kind}`}>
      {img && (
        // eslint-disable-next-line @next/next/no-img-element
        <img className="log-img" src={img} alt="" loading="lazy" />
      )}
      {entry.text}
    </div>
  );
}

export function GameLog({
  entries,
  gameId,
  className,
  endRef,
}: {
  entries: Entry[];
  gameId?: string;
  className?: string;
  endRef?: React.RefObject<HTMLDivElement | null>;
}): React.ReactElement {
  return (
    <div className={className ?? "gamelog"}>
      {entries.map((e, i) => (
        <LogEntryView key={i} entry={e} gameId={gameId} />
      ))}
      {endRef && <div ref={endRef} />}
    </div>
  );
}
