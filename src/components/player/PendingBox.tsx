import { GameConfig, GameState } from "@/lib/schema";
import { clockOf } from "@/lib/engine";

/**
 * 待办箱：已经发出去、还在等回音的事。
 *
 * 经理类游戏里「报价发出去了，对方在考虑」这件事本身就是内容——玩家需要看得见
 * 自己同时押了几件事、各自还要等几回合。没有这个面板，pend 出去的东西就像石沉大海。
 */
export default function PendingBox({
  config,
  state,
}: {
  config: GameConfig;
  state: GameState;
}): React.ReactElement | null {
  const items = state.pendings ?? [];
  if (!config.pendings?.length || items.length === 0) return null;
  const now = clockOf(config, state);
  const turnLabel = config.driver.kind === "sim" ? config.driver.time.turnLabel : "回合";

  return (
    <section className="pending-box">
      <div className="pending-title">
        等回音
        <span className="pending-count">{items.length}</span>
      </div>
      {[...items]
        .sort((a, b) => a.dueTurn - b.dueTurn)
        .map((it) => {
          const def = config.pendings!.find((d) => d.id === it.def);
          if (!def) return null;
          const left = Math.max(0, it.dueTurn - now);
          const who = it.target ? config.entities?.find((e) => e.id === it.target)?.name : undefined;
          return (
            <div key={it.key} className="pending-item">
              <div className="pending-head">
                <b>{def.name}</b>
                {who && <span className="pending-who">{who}</span>}
                <span className="pending-due">{left === 0 ? "本" + turnLabel + "出结果" : `还要 ${left} ${turnLabel}`}</span>
              </div>
              {def.waitingText && <div className="pending-note">{def.waitingText}</div>}
            </div>
          );
        })}
    </section>
  );
}
