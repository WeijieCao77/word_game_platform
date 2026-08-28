/**
 * 自由模式作品的**发布门槛**。
 *
 * 起因是设计体检第一条，而那一条的现场是老板的一句投诉：
 * 「游戏库里新出现的 val manager 根本玩不了，显示出错。是不是现在平台新做的游戏都有问题」。
 *
 * 那部作品开局就抛 `registerSetup is not defined`，一路发布进了公开游戏库，
 * **没有任何一道关拦它**。原因是发布那一步跑的是 `validateGameConfig(record.config)`——
 * 而自由模式作品的 `config` 是新建时生成的一份空白故事配置，**根本不参与运行**
 * （玩家跑的是 `files` 里的 html/js/css）。于是这道门槛永远是绿的：
 * **文件一个字都没看过就放行。**
 *
 * 快速模式发布前要过三级校验 + 断头路检查；自由模式发布 = 直接翻牌。
 * 这个文件就是把那道口子堵上。
 *
 * 平台其实**早就有**这几把尺子，只是发布这一步没接上去：
 *
 *   1. `syntax-check.ts` —— 文件本身能不能解析
 *   2. `wiring.ts`       —— 脚本有没有挂进 index.html
 *   3. `js-refs.ts`      —— 调了一个谁都没定义的名字
 *   4. `playcheck/`      —— 真的去点一遍：走不走得动、点了有没有反应
 *
 * 判罚照快速模式的规矩：**error 拦住，warning 放行并明说**。
 *
 * 关于第 4 条有一条硬规矩，值得单独写出来：**没体检过一律拦住**。
 * 「没测到」不等于「没问题」——平台在这件事上已经栽过五次（见 PITFALLS 一）。
 * 拦住的时候必须告诉作者怎么解（去工作台点一下体检），不能只甩一句「不行」。
 */

import { checkFileSyntax, describeProblem } from "@/lib/syntax-check";
import { checkWiring } from "@/lib/wiring";
import { checkMissingRefs } from "@/lib/js-refs";
import { PlayCheckReport, playCheckHasIssue } from "@/lib/playcheck/types";
import { describeNumbers, summarizePlayCheck } from "@/lib/playcheck/report";

/** 门槛看到的一个文件 */
export interface GateFile {
  path: string;
  content: string;
  /** ISO 时间戳。用来判断体检报告是不是改文件之前跑的 */
  updatedAt: string;
}

export interface GateIssue {
  /** error 拦住发布；warn 放行，但要让作者看见 */
  level: "error" | "warn";
  /** 哪儿不行，一句话说清 */
  what: string;
  /** 怎么办。**每一条 error 都得有**——只说「不行」不告诉人怎么解，等于没说 */
  how?: string;
}

/** 通读代码那一层的字节上限：太大就跳过（这层是尽力而为，不是必过项） */
const READ_ALL_BYTES = 3_000_000;

/**
 * 自由模式作品能不能发布。
 *
 * 纯函数：给文件和最近一次体检报告，回一串问题。**没有 error 就是能发。**
 */
export function checkCodePublish(files: GateFile[], check: PlayCheckReport | null): GateIssue[] {
  const issues: GateIssue[] = [];

  // ── 0. 连入口都没有 ─────────────────────────────────────────
  const index = files.find((f) => /(^|\/)index\.html$/i.test(f.path));
  if (!index) {
    issues.push({
      level: "error",
      what: "这部作品没有 index.html——玩家点开链接会看到一片空白。",
      how: "让 AI 写一个 index.html 当入口，把用到的 js/css 都在里面引上。",
    });
    // 入口都没有，下面几层没什么好查的
    return issues;
  }

  // ── 1. 语法：文件本身解析得了吗 ─────────────────────────────
  //
  // 带着语法错误上线，玩家看到的是黑屏，而错误信息到了浏览器里
  // 已经被跨域遮蔽成一句 Script error.，回头谁也查不出来。
  for (const f of files) {
    const bad = checkFileSyntax(f.path, f.content);
    if (bad) {
      issues.push({
        level: "error",
        what: describeProblem(bad),
        how: "把这个文件里那一行改对；改完平台写入的时候会当场再验一遍。",
      });
    }
  }

  // ── 2. 接线：脚本挂进 index.html 了吗 ───────────────────────
  const bag: Record<string, string> = {};
  for (const f of files) bag[f.path] = f.path === index.path ? f.content : "";
  const wiring = checkWiring(bag);
  for (const p of wiring.broken) {
    issues.push({
      level: "error",
      what: `index.html 引用了 ${p}，可作品里没有这个文件——浏览器会 404。`,
      how: `要么把 ${p} 写出来，要么把 index.html 里那一行引用删掉。`,
    });
  }
  for (const p of wiring.orphans) {
    // 孤儿文件不一定是错的（可能是给别的脚本 import 的），所以只警告
    issues.push({
      level: "warn",
      what: `${p} 在作品里，但 index.html 没引用它——它不会被加载。`,
      how: `确认是故意的（比如被别的模块 import）就不用管；不是的话在 index.html 里引上。`,
    });
  }

  // ── 3. 调了一个谁都没定义的名字 ─────────────────────────────
  //
  // 线上真死过一部作品：registerSetup is not defined（game.js:308:3），
  // 玩家点开只剩 64 个字。语法检查查不出来（那行是合法 JS），
  // 接线体检也查不出来（文件都引了）——只有把代码通读一遍才看得见。
  const jsFiles = files.filter((f) => /\.(js|mjs)$/i.test(f.path));
  const jsBytes = jsFiles.reduce((n, f) => n + f.content.length, 0);
  if (jsBytes > 0 && jsBytes <= READ_ALL_BYTES) {
    const full: Record<string, string> = { [index.path]: index.content };
    for (const f of jsFiles) full[f.path] = f.content;
    for (const ref of checkMissingRefs(full)) {
      if (ref.kind === "too-late") {
        issues.push({
          level: "warn",
          what: `${ref.file}:${ref.line} 加载时就调用了 ${ref.name}，而它定义在排在后面的 ${ref.definedIn}。`,
          how: "把这一句挪进函数里，或者在 index.html 里把两个脚本的顺序调过来。",
        });
      } else {
        issues.push({
          level: "error",
          what:
            ref.kind === "nowhere"
              ? `${ref.file}:${ref.line} 调用了 ${ref.name}，整部作品里没有任何地方定义它——开局就会抛 ${ref.name} is not defined。`
              : `${ref.file}:${ref.line} 调用了 ${ref.name}，它定义在 ${ref.definedIn}，可那个文件没被 index.html 加载。`,
          how:
            ref.kind === "nowhere"
              ? `把 ${ref.name} 写出来，或者把这一句改成调用真实存在的函数。`
              : `在 index.html 里把 ${ref.definedIn} 引上。`,
        });
      }
    }
  } else if (jsBytes > READ_ALL_BYTES) {
    issues.push({
      level: "warn",
      what: `作品的 js 有 ${Math.round(jsBytes / 100000) / 10}MB，太大了，「调了没定义的名字」这一层跳过没查。`,
      how: "这一层只是尽力而为，不影响发布；试玩体检那一层照常拦。",
    });
  }

  // ── 4. 真的去点一遍：走不走得动 ─────────────────────────────
  //
  // 前三层都是静态的，查不出「点了没反应」这类问题——而老板的投诉里
  // 一半以上正是这一类：页面渲染正常、控制台干干净净，可就是玩不下去。
  const newest = files.reduce((t, f) => (f.updatedAt > t ? f.updatedAt : t), "");
  if (!check) {
    issues.push({
      level: "error",
      what: "这部作品**还没做过试玩体检**——平台没真的去点过一遍，不知道它玩不玩得动。",
      how: "在工作台的「体检」页签点一下「再体检一次」（或者让 AI 调一次 play_check），过了就能发。",
    });
  } else if (newest && check.at < newest) {
    // 「体检过」不等于「体检的是现在这一版」。
    // 改完文件不重新体检就发布，等于拿上一版的结论给这一版背书。
    issues.push({
      level: "error",
      what: "最近这次体检是在**改文件之前**跑的，它给不出现在这一版的结论。",
      how: "在工作台重新体检一次再发布。",
    });
  } else if (playCheckHasIssue(check)) {
    issues.push({
      level: "error",
      what: `试玩体检没过：${summarizePlayCheck(check)}`,
      how: "去工作台的「体检」页签看详情，或者直接点「让 AI 去修」。修完重新体检，绿了就能发。",
    });
  }

  // ── 5. 数值那几样只提醒的 ───────────────────────────────────
  //
  // 「玩家眼前出现 NaN」已经在上面被 playCheckHasIssue 判成硬伤了。
  // 剩下这三样**有可能是作者故意的**（一个亿的资金、序章就是个小结局），
  // 判成硬伤会把人逼着去改本来没错的东西，所以只警告。
  if (check) {
    for (const line of describeNumbers(check.numbers)) {
      if (line.includes("NaN / undefined")) continue; // 那一条已经拦住了，不重复说
      issues.push({ level: "warn", what: line.replace(/^· /, ""), how: "真是故意的就忽略这条。" });
    }
  }

  return issues;
}

/** 有 error 就发不了 */
export function gateBlocks(issues: GateIssue[]): boolean {
  return issues.some((i) => i.level === "error");
}

/** 把门槛结论说成一段人话（发布失败时显示给作者） */
export function describeGate(issues: GateIssue[]): string {
  const errors = issues.filter((i) => i.level === "error");
  const warns = issues.filter((i) => i.level === "warn");
  if (!errors.length && !warns.length) return "发布体检全过。";

  const lines: string[] = [];
  if (errors.length) {
    lines.push(`发不了，有 ${errors.length} 处得先修：`);
    for (const e of errors) lines.push(`· ${e.what}${e.how ? `\n  怎么办：${e.how}` : ""}`);
  }
  if (warns.length) {
    lines.push(errors.length ? "另外这几条不拦发布，但值得看一眼：" : "能发，但这几条值得看一眼：");
    for (const w of warns) lines.push(`· ${w.what}${w.how ? `\n  怎么办：${w.how}` : ""}`);
  }
  return lines.join("\n");
}
