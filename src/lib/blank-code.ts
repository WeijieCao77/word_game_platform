// 自由模式的起手文件。
//
// 新建一部自由模式作品时先落这三份，作用有五个：
// 1. 预览不是白屏——作者一进工作台就看得见东西，知道自己站在哪
// 2. 给 AI 一个能照着改的骨架
// 3. 顺带告诉作者「界面归你定」这件事
// 4. **示范运行库的用法**：wgp.css + wgp.js 是平台垫在每部作品下面的地基，
//    起手页自己就用它，AI 第一次读文件就看得见正确的写法
// 5. **从第一秒就是拆开的**：index.html 只留骨架，样式在 style.css，逻辑在 game.js。
//    实测里 AI 会把两万多字符全塞进 index.html，之后想改一处就得整份重吐——
//    而 VAL MANAGER 那个体量（13,132 行）根本不可能一份文件写完。
//    与其在守则里反复叮嘱「要拆开」，不如让它一上来就在拆好的文件里干活。
//
// 注意这些文件是要发给浏览器的字符串，别在里面写平台的东西。

/** 起手时落进作品的全部文件 */
export function blankCodeFiles(title: string): { path: string; content: string }[] {
  return [
    { path: "index.html", content: blankCodeIndex(title) },
    { path: "style.css", content: BLANK_CODE_STYLE },
    { path: "game.js", content: blankCodeGame(title) },
  ];
}

export function blankCodeIndex(title: string): string {
  const safe = title.replace(/[<>&]/g, "");
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<title>${safe}</title>
<!-- 平台运行库：不必自带，/play 下虚拟出来的。想换皮就在 style.css 里重写 :root -->
<link rel="stylesheet" href="wgp.css" />
<link rel="stylesheet" href="style.css" />
</head>
<body>
<div id="app"></div>
<script src="wgp.js"></script>
<script src="game.js"></script>
</body>
</html>
`;
}

/** 作品自己的皮肤：只覆盖它想改的，其余继承运行库 */
const BLANK_CODE_STYLE = `/* 这部作品的样式。运行库的颜色全是 CSS 变量，在这里重写就换一套皮。 */
:root {
  /* --wgp-bg: #0e1116; --wgp-accent: #7cc4ff; … 想改哪个写哪个 */
}

.start { max-width: 34rem; margin: 8vh auto 0; }
.start h1 { margin: 0 0 4px; font-size: 21px; letter-spacing: .04em; }
.start .sub { color: var(--wgp-dim); font-size: 13px; margin-bottom: 18px; }
.start ul { color: var(--wgp-dim); font-size: 13.5px; line-height: 1.9; padding-left: 1.2em; }
`;

/** 作品的逻辑：一屏、一个按钮、一次存档，够示范就行 */
function blankCodeGame(title: string): string {
  const safe = title.replace(/[<>&]/g, "");
  return `// 这部作品的逻辑。起手骨架，等着被替换。
//
// 平台的运行库已经load好了，直接用 WGP：
//   WGP.mount / screen / nav / go / back / refresh   界面
//   WGP.ui.panel / stats / bar / table / actions     积木
//   WGP.text(...).say / speak / choices              打字机文字流
//   WGP.rng(种子)                                     可复现随机数
//   WGP.data("roster")                               数据表（data/roster.csv）
//   WGP.ready / save / saveLater                     存档（沙箱里存不到浏览器本地）

var state = { taps: 0 };

WGP.mount("#app");

WGP.screen("start", function (root) {
  root.appendChild(
    WGP.el("div", { class: "start" }, [
      WGP.el("h1", { text: ${JSON.stringify(safe)} }),
      WGP.el("div", { class: "sub", text: "自由模式 · 这一页是起手骨架，等着被替换" }),
      WGP.ui.panel("界面归你定", [
        WGP.el("p", { text: "这部作品的界面由它自己的代码决定——你现在看到的这一页，就是它现在的全部。" }),
        WGP.el("ul", {}, [
          WGP.el("li", { text: "回到左边跟 AI 说你想要的样子，它会把页面写出来" }),
          WGP.el("li", { text: "它写了什么，你在「文件」页签里看得见" }),
          WGP.el("li", { text: "存档由平台代管，换设备也在" }),
        ]),
        WGP.ui.actions([
          {
            label: "试一下存档",
            hint: state.taps === 0 ? "还没点过" : "点过 " + state.taps + " 次，刷新也还在",
            onPick: function () {
              state.taps += 1;
              WGP.save(state);   // 沙箱里存不到浏览器本地，存档只能交给平台
              WGP.refresh();     // 数值改了就地重画
              WGP.ui.toast("存好了");
            },
          },
        ]),
      ]),
    ])
  );
});

// 等平台把存档送回来再开画；没有存档就拿到 null
WGP.ready(function (saved) {
  if (saved && typeof saved.taps === "number") state = saved;
  WGP.go("start");
});
`;
}
