/**
 * 「我明明修好了，怎么还是那个报错」——草稿与线上快照的落差。
 *
 * 平台的规矩是：**作者看草稿，玩家看最近一次发布的快照**（见 /play 路由）。
 * 这条规矩本身没错，但它对 AI 是隐形的，于是实测里出了这么一幕：
 *
 *   冒烟检查报「ng2 崩了：Cannot read properties of undefined」
 *   → AI 打补丁修好 → 再玩一遍，**一模一样的报错**
 *   → AI 再修 → 还是一模一样
 *   → 第三轮 AI 得出结论：「这是旧版本留下的记录，行号跟当前文件对不上，
 *      当前代码已不可能触发」，于是**不改了**。
 *
 * 它的观察是对的（行号确实对不上），推论是错的：不是记录旧，是**玩家在玩的
 * 那份代码旧**——发布只做过一次，之后三轮补丁全落在草稿上，没人再发布。
 * 三轮、八十万 token，全花在跟一个不可能变的版本较劲。
 *
 * 所以要把这件事**说出来**：只要草稿和线上快照有出入，就在 AI 每一轮的上下文里
 * 明写「玩家看到的还是旧的那份」，并告诉它怎么办（让作者发布，或者用预览看草稿）。
 *
 * 补一句历史：这段话原来写的是「先请创作者点『发布』」，**而作者的界面上
 * 根本没有那个按钮**——作品一旦发布，那个位置写的是「取消发布」。
 * 现在顶栏有了「发新版本」，这句话才第一次说得通。
 */

export interface DriftInfo {
  /** 已发布过吗 */
  published: boolean;
  /** 草稿里有、快照里没有或不一样的文件 */
  changed: string[];
  /** 快照里有、草稿里已经删掉的文件 */
  removed: string[];
}

export function comparePublished(
  draft: Record<string, string>,
  live: Record<string, string> | null
): DriftInfo {
  if (!live) return { published: false, changed: [], removed: [] };
  const changed = Object.keys(draft).filter((p) => draft[p] !== live[p]);
  const removed = Object.keys(live).filter((p) => !(p in draft));
  return { published: true, changed: changed.sort(), removed: removed.sort() };
}

/** 写成一句给 AI 看的话；没落差就返回空串 */
export function describeDrift(d: DriftInfo): string {
  if (!d.published) return "";
  const n = d.changed.length + d.removed.length;
  if (n === 0) return "";
  const list = [...d.changed, ...d.removed.map((p) => `${p}（已删）`)].slice(0, 8).join("、");
  return (
    `⚠ 有 ${n} 个文件改了还没发布：${list}${n > 8 ? " 等" : ""}。\n` +
    `**玩家、以及任何不带编辑钥匙来试玩的人，看到的仍然是上一次发布的旧版本**——` +
    `所以「我改完了，怎么报错一模一样、行号还对不上当前文件」不是记录过期，` +
    `是他们根本没在跑你刚写的代码。别再把这种报错当成旧记录，` +
    `先请创作者点顶栏的「发新版本」（或者用工作台预览看草稿），再判断修没修好。`
  );
}
