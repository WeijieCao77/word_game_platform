/**
 * 自由模式作品的「别再黑屏」处理：在服务端出口给 index.html 注入一段兜底诊断脚本。
 *
 * 起因是老板打开一部作品看到**纯黑一片**，什么提示都没有。查下来是两层问题叠在一起：
 *
 * 1. 作品的 js 里有个语法错误 → 脚本一行没执行 → 页面只剩底色。
 * 2. 更要命的是**谁也看不出错在哪**：沙箱 iframe 用的是 `sandbox="allow-scripts"`，
 *    没有 allow-same-origin，文档处在**不透明源**上；而脚本是从平台域取的，
 *    于是浏览器判定跨域，把 `window.onerror` 的详情抹成一句 `Script error.`，
 *    行号文件名全没了。AI 的 read_errors 拿到的就是这个，它逐行读完 808 行也找不到，
 *    最后花了四轮去论证「这是检查器误判」。
 *
 * 两件事一起做才有用：
 *
 * - **给脚本标 crossorigin**：`<script src>` 加上 `crossorigin="anonymous"`，
 *   配合出口的 `Access-Control-Allow-Origin: *`，浏览器就肯把真实的
 *   message / filename / lineno 交出来。两者缺一不可——只加 crossorigin 而没有
 *   ACAO，脚本会直接加载失败，那就更糟了。
 * - **兜底显示**：注入的脚本比作品自己的任何代码都先跑，出错就在页面顶部画一条
 *   看得见的横幅（哪个文件第几行、什么错），并把它 postMessage 给外壳记进 game_errors。
 *   这样玩家不会对着黑屏发呆，作者和 AI 也终于有了真线索。
 *
 * 注意这一层是**出口注入**，不改作品的文件：所有已经存在的作品立刻受益，
 * 不需要 AI 再写一轮。
 */

/** 注入的兜底脚本。写成 ES5、不依赖任何东西——它要在最坏的情况下也能跑起来。 */
const BOOT = `<script>(function(){
  var shown = 0;
  function bar(title, detail){
    if (shown) return; shown = 1;
    try{
      var d = document.createElement("div");
      d.setAttribute("data-wgp-error","1");
      d.style.cssText = "position:fixed;left:0;right:0;top:0;z-index:2147483647;"
        + "background:#7f1d1d;color:#fff;font:13px/1.6 ui-monospace,Menlo,Consolas,monospace;"
        + "padding:10px 14px;white-space:pre-wrap;word-break:break-all;box-shadow:0 2px 10px rgba(0,0,0,.4)";
      d.textContent = title + (detail ? "\\n" + detail : "");
      (document.body || document.documentElement).appendChild(d);
    }catch(_){}
  }
  // 外壳（React）是挂载之后才装上 message 监听的，而作品第一行就炸的时候
  // 报错比那早得多——只发一次必然被漏掉（实测就是这么丢的）。
  // 所以攒起来重发几次；服务端按消息去重，重复无害。
  var queue = [];
  function flush(){
    for (var i = 0; i < queue.length; i++) {
      try{ parent.postMessage({type:"wgp:error", data:queue[i]}, "*"); }catch(_){}
    }
  }
  function post(msg, stack, where){
    queue.push({
      message:String(msg||"").slice(0,200),
      stack:String(stack||"").slice(0,2000),
      source:String(where||"")
    });
    if (queue.length > 20) queue.shift();
    flush();
    setTimeout(flush, 400); setTimeout(flush, 1200); setTimeout(flush, 3000);
  }

  // 不是这部作品的错，一概不管。
  //
  // 上线第一天就踩到了：一个**全新的空作品**顶上挂着一条血红的
  // 「这部作品有一个没被处理的异步错误：Failed to connect to MetaMask」——
  // 那是玩家浏览器里的加密钱包插件在喊，跟作品一点关系都没有。
  // 误报比不报还坏：它会让作者以为平台坏了，也会把垃圾塞进 AI 的 read_errors，
  // 让它去修一个根本不存在的 bug。宁可漏掉一条，也不许冤枉作品。
  var NOISE = /(metamask|ethereum|web3|solana|phantom|coinbase|walletconnect|chrome-extension|moz-extension|safari-web-extension|ResizeObserver loop|Non-Error promise rejection captured)/i;
  function foreign(msg, file){
    if (NOISE.test(String(msg||""))) return true;
    // 插件注入的脚本有自己的协议前缀，明确不是我们的文件
    if (/^(chrome|moz|safari-web)-extension:/i.test(String(file||""))) return true;
    return false;
  }

  window.addEventListener("error", function(e){
    if(!e) return;
    var msg = (e.error && e.error.message) || e.message || "未知错误";
    if (foreign(msg, e.filename)) return;
    var where = e.filename ? (e.filename.split("/").pop() + ":" + e.lineno + ":" + e.colno) : "";
    // Script error. = 浏览器把跨域脚本的详情抹掉了。真出现就说清楚是怎么回事，
    // 别让人以为平台在藏信息。
    if (/^Script error\\.?$/i.test(msg)) {
      bar("这部作品的代码出错了，游戏没能启动。",
          "浏览器没有交出详情（跨域遮蔽）。请把这句话告诉 AI 策划，让它用 read_errors 复查。");
    } else {
      bar("这部作品的代码出错了，游戏没能启动。", msg + (where ? "  （" + where + "）" : ""));
    }
    post(msg, e.error && e.error.stack, where);
  }, true);

  // 没被处理的 Promise 拒绝：**只记录，不弹横幅**。
  // 它拿不到文件名，归不了因；而且十有八九来自插件或第三方脚本，
  // 作品本身照样跑得好好的。真炸了的话上面那条 error 会管。
  window.addEventListener("unhandledrejection", function(e){
    var r = e && e.reason;
    var msg = (r && r.message) || String(r);
    if (foreign(msg, "")) return;
    post(msg, r && r.stack, "Promise");
  });
})();</script>`;

/**
 * 给作品的 `<script src="...">` 标上 crossorigin。
 * 只动本地相对路径：外链（http(s)://、//）本来就取不到（CSP connect/script-src 只允许 self），
 * 而 data:/blob: 没有跨域问题，标了反而可能出岔子。
 */
function markCrossOrigin(html: string): string {
  return html.replace(/<script\b([^>]*?)\bsrc\s*=\s*("|')([^"']+)\2([^>]*)>/gi, (m, pre, q, src, post) => {
    if (/^(https?:)?\/\//i.test(src) || /^(data|blob):/i.test(src)) return m;
    if (/\bcrossorigin\b/i.test(m)) return m;
    return `<script${pre}src=${q}${src}${q}${post} crossorigin="anonymous">`;
  });
}

/**
 * 出口注入：兜底诊断脚本要**排在作品自己的所有脚本之前**，
 * 不然作品第一行就炸的时候它还没装上监听。
 */
export function injectPlayDiagnostics(html: string): string {
  const withCors = markCrossOrigin(html);
  // 有 <head> 就贴在它后面；没有就顶在最前面（残缺的 html 浏览器照样能跑）
  const head = withCors.search(/<head\b[^>]*>/i);
  if (head >= 0) {
    const end = withCors.indexOf(">", head) + 1;
    return withCors.slice(0, end) + BOOT + withCors.slice(end);
  }
  return BOOT + withCors;
}
