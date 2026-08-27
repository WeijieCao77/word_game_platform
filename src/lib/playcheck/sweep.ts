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
const BUDGET_MS = 20000;
/** 开局最多往前走几步（捏人流程动辄四五步，走不到主界面就永远测不到导航） */
const MAX_STEPS = 14;
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

  /**
   * 数值这一层：**不懂这个游戏也能判断的那几样毛病**。
   *
   * 快速模式有 600 局模拟兜底（全结局可达、全卡片触发、开局即死率 0），
   * 自由模式**一局都不跑**——数值全在 AI 写的 js 里，平台没有形式化模型可模拟。
   * 老板的原话是「这个游戏全是问题，不仅是功能，还有数值」。
   *
   * 这里只做通用的那一小步：每走一步、每切一页，把玩家**眼前那一屏**扫一遍，
   * 挑出四种跟玩法无关的毛病。判据全部选「误报代价低、漏报才要命」的那一侧，
   * 拿不准的一律不报——今天已经为假阳性赔过两轮了。
   */
  var numbers = { nan: [], huge: [], noisy: [], earlyEnd: "" };

  // 「玩家眼前出现 NaN」这种事没有任何辩解余地。\b 边界防止误伤
  // undefinedBehavior 之类的正常词。
  var NAN_RE = /(^|[^A-Za-z0-9_])(NaN|Infinity|-Infinity|undefined|\[object Object\])([^A-Za-z0-9_]|$)/;
  // 数字：允许千分位和小数
  var NUM_RE = /-?\d[\d,]*(?:\.\d+)?/g;
  // 开局就结束：只在最前面几步查，措辞取最没有歧义的那几个
  var END_RE = /(游戏结束|游戏失败|Game Over|你被解雇|再来一局|重新开始一局|以失败告终)/i;

  function push(list, v){
    if (list.length < 6 && list.indexOf(v) < 0) list.push(v);
  }

  /** 扫一屏。step 是当前走到第几步（0 = 开局第一屏） */
  function sampleNumbers(step){
    var t = text();
    var m = NAN_RE.exec(t);
    if (m){
      // 把它周围的字一起带上——光说「有个 NaN」没法定位
      var at = t.indexOf(m[2]);
      // 前后各取一小段，够看出「哪个字段坏了」就行——取太长反而看不清
      push(numbers.nan, t.slice(Math.max(0, at - 10), at + m[2].length + 8).replace(/\s+/g, " ").trim());
    }
    var nums = t.match(NUM_RE) || [];
    for (var i = 0; i < nums.length && i < 400; i++){
      var raw = nums[i];
      var v = Number(raw.replace(/,/g, ""));
      if (!isFinite(v)) continue;
      // 荒谬量级：一万亿。正常作品的钱、声望、分数都到不了这儿
      if (Math.abs(v) >= 1e12) push(numbers.huge, raw);
      // 小数点后一长串 = 浮点噪声没格式化就端给玩家（0.1+0.2 那一类）
      var dot = raw.indexOf(".");
      if (dot >= 0 && raw.length - dot - 1 >= 8) push(numbers.noisy, raw);
    }
    // 开局三步之内就弹结束——玩家还没玩就完了
    if (step <= 3 && !numbers.earlyEnd){
      var e = END_RE.exec(t);
      if (e) numbers.earlyEnd = "第 " + step + " 步就出现了「" + e[1] + "」";
    }
  }
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

  /**
   * 「往前走」的那个按钮，优先点它。
   *
   * 这一条是线上实测逼出来的：体检按 DOM 顺序挨个点，点中的往往是「上一步」
   * 或者某张卡片，于是在开局那几屏里来回打转，走满 8 步也没走到主界面，
   * 报「没找到导航」——而同一部作品，先填字段再点主按钮，四步就进主界面、
   * 导航 11 项。**测不到导航，老板那条「一排点不了」就永远验不到。**
   * 所以先按语义挑主按钮，挑不出来再按 DOM 顺序。
   */
  var PRIMARY = /(下一步|下一頁|继续|繼續|开始|開始|确定|確定|确认|確認|进入|進入|完成|提交|创建|創建|出发|出發|next|start|continue|confirm|submit|begin|play)/i;

  /**
   * 「点了会变，但变回一个看过的屏」的那些东西——**在原地打转**。
   *
   * 这是线上对账量出来的：挑东家那一屏有四个赛区页签，点哪个都换一批战队，
   * 每一下 sig() 都真的变了，于是每一下都算「走通一步」。走查就这么在
   * Americas / EMEA / Pacific / China 之间来回点满 14 步，一次都没点到战队卡片，
   * 报「走了 14 步没走到主界面」。而同一时刻另一个走查器 5 步就进了 11 项主导航。
   *
   * **「界面变了」不等于「往前走了」。** 所以把这些标签记下来沉到最后：
   * 第一次点某个页签是探路（该点），第二次点它就是打转（先去试别的）。
   */
  var boring = {};

  function ordered(cands){
    var a = [], b = [], c = [];
    for (var i = 0; i < cands.length; i++) {
      var name = label(cands[i]);
      if (boring[name]) c.push(cands[i]);
      else (PRIMARY.test(name) ? a : b).push(cands[i]);
    }
    return a.concat(b).concat(c);
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
    var steps = [], stuck = null, arrived = false;
    // 走过哪些屏。用来认出「这一下把我带回了看过的地方」——见上面 boring 那段。
    var seenScreens = {};
    try{ seenScreens[sig()] = 1; }catch(_){}
    // 第一屏玩家一进来就在看，走第一步之前先采一次
    try{ sampleNumbers(0); }catch(_){}
    /**
     * 哪些标签**后来被证明是好使的**。
     *
     * 「点了没反应」只有在这个按钮**从头到尾都没反应**的时候才算数。
     * 本地真跑一遍才看见这个假阳性：走查一进挑东家那一屏就在 Americas 赛区，
     * 它点了一下「Americas」——当然一个字都不变，于是记成「点了没反应」；
     * 可再走两步它点「Americas」切回来的时候，界面明明变了。
     * **玩家点自己已经在的那个页签，本来就该没反应。**
     *
     * 这个假阳性是有代价的：线上那一轮 AI 就是照着「Americas 点了没反应」
     * 去改的，把「点已选中的页签」改成强制重绘——为了迁就一份错报告改了代码。
     */
    var worked = {};
    for (var n=1; n<=MAX_STEPS; n++){
      if (overtime()){ notes.push("体检超时，开局只走到第 " + (n-1) + " 步"); break; }
      var before = sig();
      var filled = fillInputs();
      var cands = clickables();
      if (cands.length === 0){
        stuck = {step:n, tried:[], screen:text().slice(0,300), filled:filled, why:"no-clickable"};
        break;
      }
      /**
       * 一步之内换着候选试，直到有一个真把界面往前带。
       *
       * **每试一次都重新采集候选**，这一条是本地复现逼出来的：
       * 作品只要是「innerHTML = ...」整片重画（绝大多数自由模式作品都这么写），
       * 点完第一下，之前抓到的那一批元素全部脱离文档，document.contains() 一律为假。
       * 旧写法拿着那张**过期名单**往下走，剩下的候选一个不落地被 continue 跳过——
       * 于是「一步最多试 10 个」名存实亡，**每一步实际只试得成一个**，
       * 跟当场放弃没有区别。本地复现里它点了一下「Americas」（当前就在这个赛区，
       * 点了自然没变）就报了「这一屏点遍了都没反应」，而旁边三个页签、三张战队卡片
       * 一下都没碰过。
       *
       * 按名字记「这一步试过谁」，而不是按元素——重画之后元素是新的，名字还是那个。
       */
      var tried = [], moved = false, triedNames = {};
      for (var t=0; t<MAX_TRY && !overtime(); t++){
        var order = ordered(clickables());
        var el = null, name = "";
        for (var i=0; i<order.length; i++){
          var nm = label(order[i]);
          if (triedNames[nm]) continue;
          el = order[i]; name = nm; break;
        }
        if (!el) break;
        triedNames[name] = 1;
        tried.push(name);
        await click(el);
        var after = sig();
        if (after !== before){
          moved = true;
          screenOf[name] = after;
          // 变到一个看过的屏 = 打转。下一步别再优先点它了。
          // （不算「点了没反应」——它确实有反应，只是没把人往前带。）
          if (seenScreens[after]) boring[name] = true;
          seenScreens[after] = 1;
          worked[name] = 1;
          // 走通了不等于路上没坏按钮：前面那些点了没动静的，一个个记下来。
          // 老板撞见的「起名字没地方填、点下一步原地不动」就藏在这里——
          // 体检当时接着点到导航才走动，差点把这一步判成「走通了」。
          steps.push({label: name, dead: tried.slice(0, -1), filled: filled});
          sampleNumbers(n);
          break;
        }
      }
      if (!moved){
        stuck = {step:n, tried:tried, screen:text().slice(0,300), filled:filled, why:"dead-end"};
        break;
      }
      /**
       * 走到**主**导航那一屏才收手。
       *
       * 门槛定在 6 项，比 findNav() 自己的判据严：上一版只要 findNav() 认了就停，
       * 而挑东家那一屏的四个赛区页签，容器类名叫 region-tabs 之类的，
       * 正好被 navish() 的 nav|tab|menu 认成导航——于是走到第 3 步就收手，
       * 扫完那四个页签报「试玩通过」，真正的 11 项主导航压根没走到。
       * 线上连着两次报这个假绿。
       *
       * 收手门槛与「扫哪一组」故意分开：这里只管「够不够格让我停下来」，
       * 停下来之后 findNav() 该扫谁还扫谁（真有 4 项的主导航照样扫得到）。
       */
      if (findNav().length >= 6){ arrived = true; break; }
    }
    // 走满步数还没认出主导航 = 没走到主界面。这件事必须记下来：
    // 不记的话，「走了 14 步一路没卡住」跟「走了 14 步走到主界面了」
    // 在报告里长得一模一样，服务端只能把前者也说成通过。线上就这么绿过一次。
    // 把「后来证明好使」的那些从坏按钮名单里划掉——见上面 worked 那段。
    for (var s2=0; s2<steps.length; s2++){
      steps[s2].dead = steps[s2].dead.filter(function(d){ return !worked[d]; });
    }
    return {steps:steps, stuck:stuck, arrived:arrived, walked:steps.length};
  }

  /**
   * 找导航：一堆并排的、字很短的可点元素。
   * 不认作品的类名（每部作品都不一样），只认这个形状——同一个爹下面 3 个以上短标签。
   */
  // 开局流程里的操作按钮（下一步/上一步/重来…）不是导航。
  // 不排掉的话，捏人那一屏的三个按钮就会被当成导航栏：体检以为「到主界面了」
  // 当场收手，然后把这三个按钮当导航扫一遍——自测里就是这么错的。
  var FLOW = /(上一步|上一頁|返回|重来|重來|重置|取消|放弃|放棄|back|prev|previous|cancel|reset)/i;
  function navish(el){
    try{
      var p = el.parentElement;
      for (var i = 0; i < 3 && p; i++, p = p.parentElement) {
        var tag = String(p.tagName || "").toUpperCase();
        if (tag === "NAV") return true;
        if (String(p.getAttribute("role") || "") === "navigation") return true;
        if (/(^|[\s_-])(nav|tab|tabs|menu|sidebar)([\s_-]|$)/i.test(String(p.className || ""))) return true;
      }
    }catch(_){}
    return false;
  }

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
      // 流程按钮先剔掉，再看剩下的够不够像一排导航
      var items = g.items.filter(function(el){ return !FLOW.test(label(el)) && !PRIMARY.test(label(el)); });
      if (items.length < 3) continue;
      var shortOnes = 0;
      for (var m=0;m<items.length;m++) if (label(items[m]).length <= 8) shortOnes++;
      if (shortOnes < 3) continue;
      /**
       * 只有「像主导航」的才算数——线上报过一次假绿：
       * 挑东家那一屏有四个赛区页签，体检把它当成主导航，扫完四项报
       * 「试玩通过，导航 4 项都能切」，而真正的 11 项主导航根本没走到，
       * 里面还有一项「总览」点了没反应。**假绿比不报还坏。**
       *
       * 判据两选一：挂在 <nav>/role=navigation/.nav|.tab|.menu 里，
       * 或者足够长（≥6 项）。都不满足就当没找到——宁可报「这一段没测到」。
       */
      var inNav = navish(items[0]);
      if (!inNav && items.length < 6) continue;
      groups.push({ items: items, score: items.length + (inNav ? 100 : 0) });
    }
    groups.sort(function(a,b){ return b.score - a.score; });
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
      // 每一页都是玩家会盯着看的地方，数值毛病最常露在这些页上
      try{ sampleNumbers(99); }catch(_){}
      out.push({
        label: names[i],
        changed: changed,
        // 点了没变，但这一屏正是它自己那一页 = 已经在这儿了，不算坏
        already: !changed && screenOf[names[i]] === after,
        textLen: text().replace(/\\s+/g,"").length,
        clickable: clickables().length
      });
    }

    /**
     * 补一遍：**从别的页面**再点一次那些「看着点不动」的。
     *
     * already 只认得出一种「已经在这一页了」——体检自己先点开过它。
     * 可作品一进主界面**默认就停在第一项**（总览高亮、总览的内容已经铺好），
     * 体检扫到第一项时点下去，界面当然一个字不变，于是报「总览点不动」。
     * 这是冤枉的：玩家点自己已经在的那一页，本来就没反应。
     * 线上真报过这一条，本地拿一份自己写的假作品复现出来了。
     *
     * 判据跟开局走查那边一致：**只有从别处点它也不动，才算真的点不动**。
     * 扫完一圈之后当前多半停在最后一项，这时候回头再点一次就问得出真假。
     */
    for (var k=0;k<out.length && !overtime();k++){
      if (out[k].changed || out[k].already) continue;
      var el2 = byLabel(out[k].label);
      if (!el2) continue;
      var b2 = sig();
      await click(el2);
      if (sig() !== b2){
        // 换个地方点它就动了 —— 刚才那一下只是因为已经在这一页
        out[k].already = true;
        screenOf[out[k].label] = sig();
        out[k].textLen = text().replace(/\\s+/g,"").length;
        out[k].clickable = clickables().length;
      }
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
    var report = {bootText:0, steps:[], walked:0, arrived:false, stuck:null, nav:[], numbers:numbers, notes:notes, ms:0};
    try{
      report.bootText = text().replace(/\\s+/g,"").length;
      var open = await walkOpening();
      report.steps = open.steps;
      report.walked = open.walked;
      report.arrived = open.arrived;
      report.stuck = open.stuck;
      // 开局就走不动的话，导航多半也是假的，但还是扫一眼——
      // 「一排里面很多都点不了」这种问题正好在这里现形
      report.nav = await sweepNav();
    }catch(err){
      notes.push("体检自己出错了：" + String((err && err.message) || err).slice(0,120));
    }
    report.ms = Date.now() - T0;
    report.numbers = numbers;
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
