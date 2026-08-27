/**
 * 试玩体检的浏览器端：真的去点一遍。
 *
 * 出口注入，只在带 `?wgpcheck=1` 的请求里出现——玩家和作者平时看到的页面**一个字节都不加**，
 * 更不会有人正玩着游戏被自动点掉。触发方是工作台（每轮 AI 干完自动跑一次、或作者手点）
 * 和实测脚本，它们开一个隐藏 iframe 载这个地址，等这段脚本把报告 postMessage 出来。
 *
 * 为什么放在浏览器里而不是服务端：作品是一整套 html/js/css，只有真跑起来才知道
 * 「点了有没有反应」。服务端拿到的只是字符串，静态分析看不出这种问题——
 * 这也正是前两级校验（语法、接线）漏掉老板那三次投诉的原因。
 *
 * 判据只用「界面变没变」这一条，不猜作品的玩法：
 * 点一下，等一小会儿，正文的指纹变了就算走通，一点没变就算没反应。
 * 这条判据对任何题材都成立，也不需要作品配合写任何东西。
 */

/** 一次体检最多跑多久（毫秒）。到点就把已经查到的发出来，不要干等。 */
const BUDGET_MS = 14000;
/** 开局最多往前走几步 */
const MAX_STEPS = 8;
/** 每一屏最多试点几个东西 */
const MAX_TRY = 10;
/** 导航最多扫几项 */
const MAX_NAV = 14;
/** 点完等多久看界面变没变 */
const SETTLE_MS = 350;

const SWEEP = `<script>(function(){
  var BUDGET=${BUDGET_MS}, MAX_STEPS=${MAX_STEPS}, MAX_TRY=${MAX_TRY}, MAX_NAV=${MAX_NAV}, SETTLE=${SETTLE_MS};
  var T0 = Date.now();
  var notes = [];
  function overtime(){ return Date.now() - T0 > BUDGET; }
  function sleep(ms){ return new Promise(function(r){ setTimeout(r, ms); }); }

  function text(){ try{ return (document.body && document.body.innerText) || ""; }catch(_){ return ""; } }
  // 屏幕指纹：正文压掉空白。够用又便宜——界面真变了，这串必然跟着变。
  function sig(){ return text().replace(/\\s+/g,"").slice(0,6000); }

  var SEL = "button,[role=button],.btn,.button,a[href],[onclick],[data-act],[data-action],"
          + "[data-screen],[data-tab],[data-nav],.tab,.nav-item,.card,.option,.choice,"
          + "li[data-id],input[type=submit],input[type=button],select";

  function visible(el){
    try{
      if (!el || el.disabled) return false;
      var r = el.getBoundingClientRect();
      if (r.width <= 1 || r.height <= 1) return false;
      var s = window.getComputedStyle(el);
      if (s.visibility === "hidden" || s.display === "none" || Number(s.opacity) === 0) return false;
      return true;
    }catch(_){ return false; }
  }

  function clickables(){
    var all, out = [];
    try{ all = document.querySelectorAll(SEL); }catch(_){ return []; }
    for (var i=0;i<all.length;i++) if (visible(all[i])) out.push(all[i]);
    // 去掉套娃：一个卡片里包着按钮时只留里面那个，免得同一下点两遍
    return out.filter(function(el){
      for (var j=0;j<out.length;j++) if (out[j] !== el && el.contains(out[j])) return false;
      return true;
    });
  }

  function label(el){
    var t = "";
    try{
      t = (el.innerText || el.textContent || el.value || el.getAttribute("aria-label") || "");
    }catch(_){}
    t = String(t).replace(/\\s+/g," ").trim();
    if (t) return t.slice(0,24);
    var cls = "";
    try{ cls = String(el.className || "").split(" ")[0]; }catch(_){}
    return (el.tagName || "?").toLowerCase() + (cls ? "." + cls : "");
  }

  /**
   * 空着的输入框先替玩家填一个值。
   * 不填的话开局第一步就永远过不去（「先给自己起个名字」），
   * 后面所有页面都体检不到——而那恰恰是老板撞见的那一幕。
   */
  function fillInputs(){
    var filled = [];
    var ins;
    try{ ins = document.querySelectorAll("input,textarea,select"); }catch(_){ return filled; }
    for (var i=0;i<ins.length && filled.length < 6;i++){
      var el = ins[i];
      if (!visible(el)) continue;
      var type = String(el.type || "").toLowerCase();
      if (type === "submit" || type === "button" || type === "hidden" || type === "file") continue;
      try{
        if (el.tagName === "SELECT"){
          if (el.selectedIndex > 0 || el.options.length < 2) continue;
          el.selectedIndex = 1;
        } else if (type === "checkbox" || type === "radio"){
          if (el.checked) continue;
          el.checked = true;
        } else {
          if (String(el.value || "").trim()) continue;
          el.value = (type === "number" ? "1" : "体检");
        }
        el.dispatchEvent(new Event("input", {bubbles:true}));
        el.dispatchEvent(new Event("change", {bubbles:true}));
        filled.push(label(el) || (el.name || el.id || type));
      }catch(_){}
    }
    return filled;
  }

  async function click(el){
    try{ el.scrollIntoView({block:"center"}); }catch(_){}
    try{ el.click(); }catch(_){}
    await sleep(SETTLE);
  }

  // 点了哪个东西跳出来的是哪一屏。扫导航时用它认出「已经在这一页了」，
  // 免得把「再点一次当前页」冤枉成「点不动」。
  var screenOf = {};

  /** 开局流程：一步步往前走，看能走到哪 */
  async function walkOpening(){
    var steps = [], stuck = null;
    for (var n=1; n<=MAX_STEPS; n++){
      if (overtime()){ notes.push("体检超时，开局只走到第 " + (n-1) + " 步"); break; }
      var before = sig();
      var filled = fillInputs();
      var cands = clickables();
      if (cands.length === 0){
        stuck = {step:n, tried:[], screen:text().slice(0,300), filled:filled, why:"no-clickable"};
        break;
      }
      var tried = [], moved = false;
      for (var i=0; i<cands.length && i<MAX_TRY && !overtime(); i++){
        var el = cands[i];
        if (!document.contains(el) || !visible(el)) continue;
        var name = label(el);
        tried.push(name);
        await click(el);
        if (sig() !== before){
          moved = true;
          screenOf[name] = sig();
          // 走通了不等于路上没坏按钮：前面那些点了没动静的，一个个记下来。
          // 老板撞见的「起名字没地方填、点下一步原地不动」就藏在这里——
          // 体检当时接着点到导航才走动，差点把这一步判成「走通了」。
          steps.push({label: name, dead: tried.slice(0, -1), filled: filled});
          break;
        }
      }
      if (!moved){
        stuck = {step:n, tried:tried, screen:text().slice(0,300), filled:filled, why:"dead-end"};
        break;
      }
    }
    return {steps:steps, stuck:stuck};
  }

  /**
   * 找导航：一堆并排的、字很短的可点元素。
   * 不认作品的类名（每部作品都不一样），只认这个形状——同一个爹下面 3 个以上短标签。
   */
  function findNav(){
    var cs = clickables(), groups = [], byParent = [];
    for (var i=0;i<cs.length;i++){
      var p = cs[i].parentElement; if (!p) continue;
      var hit = null;
      for (var j=0;j<byParent.length;j++) if (byParent[j].p === p) hit = byParent[j];
      if (!hit){ hit = {p:p, items:[]}; byParent.push(hit); }
      hit.items.push(cs[i]);
    }
    for (var k=0;k<byParent.length;k++){
      var g = byParent[k];
      if (g.items.length < 3) continue;
      var shortOnes = 0;
      for (var m=0;m<g.items.length;m++) if (label(g.items[m]).length <= 8) shortOnes++;
      if (shortOnes < 3) continue;
      groups.push(g);
    }
    groups.sort(function(a,b){ return b.items.length - a.items.length; });
    return groups.length ? groups[0].items.slice(0, MAX_NAV).map(label) : [];
  }

  /** 按标签重新找那一项——界面切过之后原来的元素多半已经被重画了 */
  function byLabel(name){
    var cs = clickables();
    for (var i=0;i<cs.length;i++) if (label(cs[i]) === name) return cs[i];
    return null;
  }

  async function sweepNav(){
    var names = findNav(), out = [];
    for (var i=0;i<names.length && !overtime();i++){
      var el = byLabel(names[i]);
      if (!el) continue;
      var before = sig();
      await click(el);
      var after = sig();
      var changed = after !== before;
      if (changed) screenOf[names[i]] = after;
      out.push({
        label: names[i],
        changed: changed,
        // 点了没变，但这一屏正是它自己那一页 = 已经在这儿了，不算坏
        already: !changed && screenOf[names[i]] === after,
        textLen: text().replace(/\\s+/g,"").length,
        clickable: clickables().length
      });
    }
    if (names.length && overtime()) notes.push("体检超时，导航只扫到 " + out.length + "/" + names.length + " 项");
    return out;
  }

  function send(report){
    for (var i=0;i<3;i++){
      (function(k){ setTimeout(function(){
        try{ parent.postMessage({type:"wgp:playcheck", data:report}, "*"); }catch(_){}
      }, k*300); })(i);
    }
  }

  // 等作品自己启动完再动手。开局体检（BOOT 里那段）是 2.5 秒，这里排在它后面。
  setTimeout(async function(){
    var report = {bootText:0, steps:[], stuck:null, nav:[], notes:notes, ms:0};
    try{
      report.bootText = text().replace(/\\s+/g,"").length;
      var open = await walkOpening();
      report.steps = open.steps;
      report.stuck = open.stuck;
      // 开局就走不动的话，导航多半也是假的，但还是扫一眼——
      // 「一排里面很多都点不了」这种问题正好在这里现形
      report.nav = await sweepNav();
    }catch(err){
      notes.push("体检自己出错了：" + String((err && err.message) || err).slice(0,120));
    }
    report.ms = Date.now() - T0;
    report.notes = notes;
    send(report);
  }, 2600);
})();</script>`;

/** 把体检脚本塞进 head 末尾——它要在作品的脚本装完之后才动手 */
export function injectPlayCheck(html: string): string {
  const head = html.search(/<\/head\s*>/i);
  if (head >= 0) return html.slice(0, head) + SWEEP + html.slice(head);
  return html + SWEEP;
}
