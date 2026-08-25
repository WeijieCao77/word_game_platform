// 自由模式的起手文件。
//
// 新建一部自由模式作品时先落这一份，作用有三个：
// 1. 预览不是白屏——作者一进工作台就看得见东西，知道自己站在哪
// 2. 给 AI 一个能照着改的骨架（含存档桥的正确用法）
// 3. 顺带告诉作者「界面归你定」这件事
//
// 注意这份文件是要发给浏览器的字符串，别在里面写平台的东西。

export function blankCodeIndex(title: string): string {
  const safe = title.replace(/[<>&]/g, "");
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<title>${safe}</title>
<style>
  :root { --bg:#101319; --panel:#171c24; --line:#252d38; --ink:#e9ecf1; --dim:#8b95a3; --accent:#7cc4ff; }
  * { box-sizing: border-box; }
  html, body { margin:0; height:100%; }
  body {
    background: var(--bg); color: var(--ink);
    font: 16px/1.85 "Noto Serif SC", "Songti SC", Georgia, serif;
    display: flex; align-items: center; justify-content: center; padding: 24px;
  }
  .card {
    max-width: 34rem; width: 100%;
    background: var(--panel); border: 1px solid var(--line); border-radius: 14px;
    padding: 30px 28px;
  }
  h1 { margin: 0 0 6px; font-size: 21px; letter-spacing: .04em; }
  .sub { color: var(--dim); font: 13px/1.7 system-ui, -apple-system, "PingFang SC", sans-serif; margin-bottom: 20px; }
  p { margin: 0 0 1.1em; }
  ul { color: var(--dim); font: 13.5px/1.9 system-ui, sans-serif; padding-left: 1.2em; margin: 0 0 1.4em; }
  b { color: var(--accent); font-weight: 600; }
  button {
    background: none; border: 1px solid var(--line); color: var(--ink);
    border-radius: 8px; padding: 9px 16px; cursor: pointer; font: inherit; font-size: 14px;
  }
  button:hover { border-color: var(--accent); }
  .count { color: var(--dim); font: 12px system-ui, sans-serif; margin-left: 10px; }
</style>
</head>
<body>
  <div class="card">
    <h1>${safe}</h1>
    <div class="sub">自由模式 · 这一页是起手骨架，等着被替换</div>
    <p>这部作品的界面由它自己的代码决定——你现在看到的这一页，就是它现在的全部。</p>
    <ul>
      <li>回到左边跟 AI 说你想要的样子，它会把页面写出来</li>
      <li>它写了什么，你在「文件」页签里看得见</li>
      <li>存档由平台代管，换设备也在</li>
    </ul>
    <button id="tap" type="button">试一下存档</button><span class="count" id="n">还没点过</span>
  </div>
<script>
  // 存档只能走 postMessage：这个页面跑在沙箱里，用不了 localStorage
  var state = { taps: 0 };
  function render() {
    document.getElementById("n").textContent =
      state.taps === 0 ? "还没点过" : "点过 " + state.taps + " 次，刷新也还在";
  }
  document.getElementById("tap").onclick = function () {
    state.taps += 1;
    parent.postMessage({ type: "wgp:save", data: state }, "*");
    render();
  };
  window.addEventListener("message", function (e) {
    if (e.data && e.data.type === "wgp:loaded" && e.data.data && e.data.data.taps) {
      state = e.data.data;
      render();
    }
  });
  parent.postMessage({ type: "wgp:ready" }, "*");
  parent.postMessage({ type: "wgp:load" }, "*");
  render();
</script>
</body>
</html>
`;
}
