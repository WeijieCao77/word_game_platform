import { useMemo } from "react";
import { GameConfig, GameState } from "@/lib/schema";
import { pairKey } from "@/lib/engine";

/**
 * 关系网面板：谁和谁处得来、谁和谁处不来。
 *
 * 只显示「值得一提」的几对——最好的三对和最差的三对。全量两两列出来是一张
 * 没人看的矩阵；玩家真正关心的是「更衣室里有没有人快打起来了」。
 */
export default function RelationWeb({
  config,
  state,
}: {
  config: GameConfig;
  state: GameState;
}): React.ReactElement | null {
  const nameOf = useMemo(
    () => new Map((config.entities ?? []).map((e) => [e.id, e.name])),
    [config.entities]
  );

  const blocks = useMemo(() => {
    return (config.relations ?? []).map((rel) => {
      const table = state.relations?.[rel.id] ?? {};
      const rows = Object.entries(table)
        .map(([key, value]) => {
          const [a, b] = key.split("|");
          return { key, a: nameOf.get(a) ?? a, b: nameOf.get(b) ?? b, value };
        })
        // 两个角色里有一个已经不在场上（卖掉/离队）就不必再展示
        .filter((r) => nameOf.has(r.key.split("|")[0]) && nameOf.has(r.key.split("|")[1]))
        .sort((x, y) => y.value - x.value);
      return { rel, top: rows.slice(0, 3), bottom: rows.slice(-3).reverse().filter((r) => !rows.slice(0, 3).includes(r)) };
    });
  }, [config.relations, state.relations, nameOf]);

  if (!config.relations?.length) return null;
  if (blocks.every((b) => b.top.length === 0)) return null;

  return (
    <div className="relation-web">
      {blocks.map(({ rel, top, bottom }) =>
        top.length === 0 ? null : (
          <section key={rel.id} className="relation-block">
            <div className="relation-title">{rel.name}</div>
            {top.map((r) => (
              <div key={r.key} className="relation-row">
                <span className="relation-pair">
                  {r.a} <span className="relation-link">—</span> {r.b}
                </span>
                <span className="relation-value good">{Math.round(r.value)}</span>
              </div>
            ))}
            {bottom.length > 0 && <div className="relation-sep">处得最僵的</div>}
            {bottom.map((r) => (
              <div key={r.key} className="relation-row">
                <span className="relation-pair">
                  {r.a} <span className="relation-link">—</span> {r.b}
                </span>
                <span className="relation-value bad">{Math.round(r.value)}</span>
              </div>
            ))}
          </section>
        )
      )}
    </div>
  );
}
