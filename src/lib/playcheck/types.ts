/**
 * 试玩体检的报告结构。
 *
 * 这是平台的**第三只眼**，补的是前两只看不见的那一大块：
 *   1. 第一级：语法检查（`syntax-check.ts`）——文件本身能不能解析
 *   2. 第二级：接线体检（`js-refs.ts`）——调了没定义的名字、脚本没挂进 html
 *   3. 运行报错（`game_errors`）——在浏览器里**抛出来**的异常
 *
 * 但老板这两天的投诉里，一半以上**一个异常都不抛**：
 * 「这让我起名字但根本没地方填写」「这一排里面很多都点不了」「按键点了就卡了」。
 * 页面渲染正常、控制台干干净净、read_errors 空空如也，AI 每一轮拿到的都是
 * 「没有报错记录」——于是它连着四轮修不动一个开局。**让瞎子修 bug，换多强的模型都没用。**
 *
 * 所以要真的去点一遍。报告只记三样，都是不需要懂这个游戏也能判断的：
 *   - 开局能往前走几步，卡在哪一屏，那一屏点遍了什么都没反应
 *   - 导航每一项点了以后界面变没变
 *   - 切过去的那一页有没有真东西（字数、可点元素）
 */

/** 开局流程里走通的一步 */
export interface PlayStep {
  /** 最后是点了哪个东西才走动的 */
  label: string;
  /**
   * 这一步里**点了没反应**的那些。
   *
   * 这一条是自测逼出来的：坏样例第一步点「下一步」和「返回」都毫无动静，
   * 体检接着点到导航上的「阵容」，界面变了，于是判「第一步走通了」——
   * 而老板撞见的那个 bug（起名字没地方填、点下一步原地不动）**恰恰就是这两下**。
   * 走通了不等于路上没有坏按钮，所以坏的也要记下来。
   */
  dead: string[];
  /** 这一步之前先往输入框里填了什么（没填就是空） */
  filled: string[];
}

/** 走不下去的那一屏 */
export interface PlayStuck {
  /** 卡在第几步（1 起） */
  step: number;
  /** 在这一屏点过哪些东西，全都没反应 */
  tried: string[];
  /** 这一屏当时长什么样（正文截断） */
  screen: string;
  /** 这一屏有没有空着的输入框（有的话体检会先替玩家填一个值再点） */
  filled: string[];
  /** why: no-clickable = 这一屏根本没有能点的东西；dead-end = 点遍了界面不动 */
  why: "no-clickable" | "dead-end";
}

/** 导航上的一项 */
export interface PlayNavItem {
  label: string;
  /** 点了之后界面变了没有 */
  changed: boolean;
  /**
   * 点了没变，但当前这一屏本来就是这一项的页面——**已经在这一页了**，不算坏。
   *
   * 不认这件事会冤枉人：自测里体检自己先点开了「阵容」，扫导航时再点一次「阵容」
   * 界面当然不动，于是报「阵容点不动」。判据是「这一屏跟上次点它跳出来的那一屏一样」。
   */
  already: boolean;
  /** 切过去那一页的正文字数 */
  textLen: number;
  /** 切过去那一页有几个能点的东西 */
  clickable: number;
}

export interface PlayCheckReport {
  /** 体检跑完的时刻（服务端盖章，客户端说了不算） */
  at: string;
  /** 开局第一屏的正文字数——0 就是白屏 */
  bootText: number;
  /** 开局往前走通的每一步（**会被截断到 12 条**，数步数要用 walked） */
  steps: PlayStep[];
  /**
   * 真正走通了几步。
   *
   * 不能拿 `steps.length` 当步数：那个数组存下来的时候截到 12 条，
   * 于是走满 14 步的报告会说成「走了 12 步」。线上真出现过这句。
   */
  walked: number;
  /**
   * 有没有**走到主界面**（认出一排 6 项以上的导航才算）。
   *
   * 这一条是线上那次假绿逼出来的：体检走满 14 步都没走到主界面，
   * 一路上没卡住、也没坏按钮，于是 `stuck` 是 null、`nav` 里是挑东家那一屏
   * 四个赛区页签——报告长得跟通过一模一样，一句话结论直接写「试玩通过」。
   * 同一分钟里另一个检查器说的是「开局第 4 步走不下去」。
   *
   * **「走了很多步」不等于「走到了」。** 没走到就得说没走到。
   */
  arrived: boolean;
  /** 走不下去了就有这一段；一路走到底就是 null */
  stuck: PlayStuck | null;
  /** 导航扫描的结果；没找到导航就是空数组 */
  nav: PlayNavItem[];
  /** 体检自己遇到的情况（比如超时） */
  notes: string[];
  /** 体检耗时（毫秒） */
  ms: number;
}

/** 这份报告有没有查出问题 */
export function playCheckHasIssue(r: PlayCheckReport): boolean {
  if (r.bootText <= 0) return true;
  if (r.stuck) return true;
  // 没走到主界面 = 这一段没测到。平台在「把没测到说成没问题」上已经栽过五次，
  // 所以宁可误报：真是纯线性故事没有导航栏，AI 一句话就能打发掉；
  // 反过来把没走到说成通过，一轮就白费了。
  if (!r.arrived) return true;
  if (r.nav.some((n) => !n.changed && !n.already)) return true;
  if (r.steps.some((s) => s.dead.length > 0)) return true;
  // 切过去了但那一页几乎什么都没有 = 空壳
  if (r.nav.some((n) => n.changed && n.textLen < 40 && n.clickable === 0)) return true;
  return false;
}
