import { GameConfig, GameState } from "@/lib/schema";
import { formatNum } from "./util";

/** sim 阵容面板：按实体类型分表展示可见属性与标签 */
export default function Roster({ config, state }: { config: GameConfig; state: GameState }): React.ReactElement | null {
  if (!config.entityTypes?.length || !state.entities) return null;
  return (
    <div className="roster">
      {config.entityTypes.map((t) => {
        const members = (config.entities ?? []).filter((e) => e.type === t.id && state.entities![e.id]);
        if (members.length === 0) return null;
        const cols = t.attributes.filter((a) => a.visible !== false);
        return (
          <details key={t.id} className="roster-group" open>
            <summary>
              {t.name}（{members.length}）
            </summary>
            <div className="roster-scroll">
              <table>
                <thead>
                  <tr>
                    <th>名称</th>
                    {cols.map((a) => (
                      <th key={a.id}>{a.name}</th>
                    ))}
                    <th>状态</th>
                  </tr>
                </thead>
                <tbody>
                  {members.map((e) => {
                    const st = state.entities![e.id];
                    return (
                      <tr key={e.id}>
                        <td>{e.name}</td>
                        {cols.map((a) => (
                          <td key={a.id}>{formatNum(st.attrs[a.id] ?? 0)}</td>
                        ))}
                        <td>
                          {st.tags.map((tag) => (
                            <span key={tag} className="tag">
                              {tag}
                            </span>
                          ))}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </details>
        );
      })}
    </div>
  );
}
