import { EntityTypeDef, GameConfig, GameState } from "@/lib/schema";
import { formatNum } from "./util";

/**
 * sim 阵容面板：按实体类型分表展示可见属性与标签。
 *
 * 类型里配了 groups 就再按标签拆成几段（自家阵容 / 转会市场 / 伤停…）——
 * 身份完全不同的实体挤在一张表里，玩家分不清哪些是自己的人。
 * 没配 groups 就还是一张大表，老游戏不受影响。
 */
function splitByGroup(
  t: EntityTypeDef,
  members: { id: string; name: string }[],
  tagsOf: (id: string) => string[]
): { label: string; rows: { id: string; name: string }[] }[] {
  if (!t.groups?.length) return [{ label: "", rows: members }];
  const buckets = t.groups.map((g) => ({ label: g.label, rows: [] as { id: string; name: string }[] }));
  const rest: { id: string; name: string }[] = [];
  for (const m of members) {
    const tags = tagsOf(m.id);
    // 按 groups 的顺序匹配，第一个命中的收下它——一个实体只出现在一段里
    const idx = t.groups.findIndex((g) => tags.includes(g.tag));
    if (idx >= 0) buckets[idx].rows.push(m);
    else rest.push(m);
  }
  if (rest.length) buckets.push({ label: t.restLabel ?? "其他", rows: rest });
  return buckets.filter((b) => b.rows.length > 0);
}

export default function Roster({ config, state }: { config: GameConfig; state: GameState }): React.ReactElement | null {
  if (!config.entityTypes?.length || !state.entities) return null;
  const entities = state.entities;
  return (
    <div className="roster">
      {config.entityTypes.map((t) => {
        const members = (config.entities ?? []).filter((e) => e.type === t.id && entities[e.id]);
        if (members.length === 0) return null;
        const cols = t.attributes.filter((a) => a.visible !== false);
        const sections = splitByGroup(t, members, (id) => entities[id]?.tags ?? []);
        return (
          <details key={t.id} className="roster-group" open>
            <summary>
              {t.name}（{members.length}）
            </summary>
            {sections.map((sec, si) => (
              <div key={sec.label || si}>
                {sec.label && (
                  <div className="roster-section">
                    {sec.label}
                    <span className="roster-section-count">{sec.rows.length}</span>
                  </div>
                )}
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
                      {sec.rows.map((e) => {
                        const st = entities[e.id];
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
              </div>
            ))}
          </details>
        );
      })}
    </div>
  );
}
