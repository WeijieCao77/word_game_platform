/**
 * 连续搭建：一次请求让 AI 照着剩余清单连跑几轮，中间不用作者一句句催。
 *
 * 为什么要有这个东西——差距的大头是**没跑够**，而且这是算术不是借口：
 * 实测最好的一次是 12 轮搭到约 4,500 行，而 VAL MANAGER 是 13,132 行。
 * 照同样的效率要三四十轮。作者在工作台里一句句说「继续」，一次坐下最多几轮，
 * 那个体量永远到不了。这一层把「你陪着熬」换成「你去忙别的，回来看」。
 *
 * 逻辑单独放这儿而不是塞在路由里，是为了**能测**：三个出口（跑满、作者放弃、
 * 额度不够）每一个都得真的会走到，不然连续搭建就成了一个烧额度的黑盒。
 */

import { Turn, trimHistory } from "./history";

export type { Turn };

/**
 * 一次最多跑几轮。
 *
 * 20 轮 × 12 分钟 = 四个小时——已经比任何人愿意等的时间长了。
 * 真正的刹车是额度与「清单搭完了」，这个数只是兜底防跑飞。
 */
export const MAX_AUTO_ROUNDS = 20;

/**
 * 每一轮之间替作者说的那句话。
 *
 * 「不要问我要不要继续」是关键：模型的默认习惯是每轮末尾交个底等指示，
 * 那正是把三十轮的活拖成三十次对话的原因。
 */
export const KEEP_GOING =
  "接着做。照设计卡里的「剩余清单」挑没打勾的往下搭，做完一条打一个勾。" +
  "不要问我要不要继续——清单没清空就一直往下做。";

/**
 * 上一轮把作品写炸了的时候，替作者说的那句话。
 *
 * 连续搭建最坏的失败长这样：第 3 轮写出一个开局就抛异常的版本，第 4…20 轮
 * 在这个打不开的作品上继续加页面——十几轮、几百万 token，全是白干，
 * 而且没有任何人在中途叫停（作者本来就是去忙别的了）。
 * 所以每轮之间要看一眼预览有没有在报错，有就先修，不许往下盖。
 */
export function fixFirst(detail: string): string {
  return (
    "先别往下搭——预览里报错了，作品现在是打不开的：\n" +
    detail +
    "\n\n把它修掉，然后把出错那条路径从头到尾自己走一遍确认不会再抛，" +
    "再调 read_errors 带 clear: true 清掉记录，之后才接着照剩余清单往下做。"
  );
}

export function clampRounds(n: unknown): number {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v) || v < 1) return 1;
  return Math.min(MAX_AUTO_ROUNDS, v);
}

export interface AutoBuildOptions {
  rounds: number;
  history: Turn[];
  /** 跑一轮。返回值原样往上传（最后一轮的那份就是给前端的结果） */
  runOne: (history: Turn[], round: number, total: number) => Promise<Record<string, unknown>>;
  /** 这一轮还该不该开始跑——作者按了「放弃这一轮」就该是 false */
  alive?: () => boolean;
  /** 额度还够不够再跑一轮；返回一句原因表示不够 */
  quotaBlocked?: () => string | null;
  /**
   * 每轮之间怎么裁历史。默认按字符预算裁（见 history.ts）——
   * 连续搭建一次跑二十轮，历史每轮都重发一遍，按条数裁会烧掉一大笔冤枉钱。
   */
  trim?: (turns: Turn[]) => Turn[];
  /**
   * 上一轮之后作品是不是正在报错；返回报错原文表示「是」。
   *
   * 有的话下一轮说的就不是「接着做」而是「先修」——在一个打不开的作品上
   * 继续加页面，加多少都是白加。
   */
  brokenNow?: () => string | null;
}

export interface AutoBuildResult extends Record<string, unknown> {
  /** 实际跑了几轮——跟要求的轮数不一样时，stoppedBecause 会说清为什么 */
  roundsRun: number;
  /** 其中有几轮是「上一轮把作品写炸了，这一轮先去修」 */
  fixRounds?: number;
  stoppedBecause?: string;
}

/**
 * 连着跑几轮，每轮之间替作者说一句「接着做」。
 *
 * 返回**最后一轮**的结果（前端要显示的就是它），外加实际跑了几轮、为什么停。
 */
export async function runRounds(opts: AutoBuildOptions): Promise<AutoBuildResult> {
  const trim = opts.trim ?? trimHistory;
  let hist = opts.history;
  let last: Record<string, unknown> = {};
  let ran = 0;
  let fixRounds = 0;
  let stoppedBecause: string | undefined;

  for (let i = 0; i < opts.rounds; i++) {
    // 作者按了「放弃这一轮」——立刻收手，别再烧他的额度
    if (opts.alive && !opts.alive()) {
      stoppedBecause = `作者中止了连续搭建，停在第 ${i} 轮。已经写进去的部分不会丢。`;
      break;
    }
    // 第一轮的额度在路由入口已经查过了，这里查的是「还能不能再跑一轮」
    if (i > 0 && opts.quotaBlocked) {
      const why = opts.quotaBlocked();
      if (why) {
        stoppedBecause = `额度不够了，连续搭建停在第 ${i} 轮：${why}`;
        break;
      }
    }
    last = await opts.runOne(hist, i + 1, opts.rounds);
    ran += 1;
    // 下一轮说什么：作品在报错就先修，没报错才接着照清单往下搭
    const broken = opts.brokenNow?.() ?? null;
    if (broken) fixRounds += 1;
    hist = trim([
      ...hist,
      { role: "assistant" as const, content: String(last.reply ?? "") },
      { role: "user" as const, content: broken ? fixFirst(broken) : KEEP_GOING },
    ]);
  }

  return {
    ...last,
    roundsRun: ran,
    ...(fixRounds > 0 ? { fixRounds } : {}),
    ...(stoppedBecause ? { stoppedBecause } : {}),
  };
}
