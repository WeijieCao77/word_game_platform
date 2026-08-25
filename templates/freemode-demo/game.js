// 自由模式示范作品：《末班车守夜人》
//
// 这份文件存在的意义是**证明整条链路是通的**：作品自带的代码跑在沙箱 iframe 里，
// 存档经 postMessage 交给平台代存（沙箱里没有 localStorage 可用），
// 界面完全由这份作品自己决定——平台不插手。

var S = { stop: 0, wake: 10, clue: 0, at: "start", seen: {} };

var SCENES = {
  start: {
    text: [
      "末班车过了子夜就不再报站。车厢的灯比白天暗一档，暖黄，照得每张脸都像刚哭过。",
      "你是这趟车的守夜人——一份没写进合同的差事：把睡过站的人叫醒，把不该上车的人记下来。",
      "第七节车厢的最后一排坐着一个人。他从起点站就在那里，一动没动。窗外的隧道灯一道道扫过他的侧脸，他没有影子。"
    ],
    choices: [
      { label: "走过去，坐在他对面", why: "离得近才看得清，也才被看得清", to: "sit" },
      { label: "先绕车厢走一圈，看看还有谁醒着", why: "守夜人的规矩：先数人头", to: "walk" }
    ]
  },
  sit: {
    text: [
      "你在他对面坐下。皮革座椅还留着别人的余温，不是他的——他那一侧的座位是凉的。",
      "「你也看见我了。」他说这话时嘴唇没怎么动，"
        + "「上一个看见我的守夜人，在青石桥站下了车，就没再上来。」"
    ],
    effects: { clue: 1, wake: -1 },
    choices: [
      { label: "问他：青石桥站是哪一站", why: "线路图上没有这个名字", to: "bridge" },
      { label: "什么都不问，把他记进本子", why: "记下来，然后活到终点", to: "book" }
    ]
  },
  walk: {
    text: [
      "你从第一节走到第七节。醒着的有四个：抱着工具包打盹的电工、把外卖箱当枕头的骑手、"
        + "背单词背到眼睛发红的学生，还有一个把票根撕成碎条、一条条排在膝盖上的女人。",
      "女人抬头看你：「你也数不清吧。」她把碎条推给你看，"
        + "十七条，「每次数都比上次多一条。多出来的那个人，就坐在第七节。」"
    ],
    effects: { clue: 2, wake: -2 },
    choices: [
      { label: "问她数了多少晚了", why: "她显然不是第一次坐这趟车", to: "nights" },
      { label: "回第七节，去看那个人", why: "线索够了，该去正主那里", to: "sit" }
    ]
  },
  bridge: {
    text: [
      "「线路图上没有，是因为它只在有人要下车的那一夜才有。」他终于转过脸来。",
      "他的眼睛是隧道灯的颜色，一道一道地亮，又一道一道地灭。",
      "「今晚有人要下车。你猜是谁？」"
    ],
    effects: { clue: 1, wake: -2 },
    choices: [
      { label: "「是你。」", why: "他从起点站坐到现在，从没下过车", to: "himDown" },
      { label: "「不知道。但不是我。」", why: "守夜人的第一条守则：别接话", to: "notMe" }
    ]
  },
  nights: {
    text: [
      "「三百一十七晚。」她把碎条收进口袋，「我不是在等车，我是在等那一晚多出来的人变回原来的数。」",
      "车身晃了一下。广播响起来——今晚它报站了：「前方到站，青石桥。」",
      "整节车厢没有一个人抬头。只有你和她听见了。"
    ],
    effects: { clue: 2, wake: -1 },
    choices: [
      { label: "跟她一起在青石桥站下车", why: "有人要一起，就不算独自赴约", to: "downTogether" },
      { label: "拉住她，谁都不下", why: "守夜人的活是把人留在车上", to: "hold" }
    ]
  },
  book: {
    text: [
      "你把他记进本子：第七节，末排，无影。写完那一笔，钢笔尖断了。",
      "他笑了一下：「记下来的人，就归你管了。」"
    ],
    effects: { clue: 1 },
    choices: [
      { label: "合上本子，走回车头", why: "剩下的路，装作什么都没发生", to: "endKeeper" },
      { label: "把那一页撕下来", why: "不认这份差事", to: "endTear" }
    ]
  },
  himDown: {
    text: ["「答对了。」他站起来，车厢里所有的灯同时暗了半秒。", "「可惜规矩是：说出名字的人替他下车。」"],
    effects: { clue: 1, wake: -3 },
    choices: [
      { label: "在青石桥站下车", why: "认赌服输", to: "endDown" },
      { label: "抓住扶手，不下", why: "规矩是他说的，不是你定的", to: "hold" }
    ]
  },
  notMe: {
    text: ["他点点头，像是对这个答案很满意。", "「守夜人里，你算聪明的。」他重新坐正，「那就一起坐到终点吧。」"],
    effects: { wake: 1 },
    choices: [{ label: "坐到终点", why: "还有十一站", to: "endKeeper" }]
  },
  downTogether: {
    text: ["门开了。站台上没有灯，只有一块牌子写着青石桥。她先下，回头朝你伸手。"],
    choices: [
      { label: "握住她的手", why: "", to: "endDown" },
      { label: "退回车厢", why: "", to: "endKeeper" }
    ]
  },
  hold: {
    text: [
      "门开着，开了很久。没有人下车。",
      "广播重复了三遍青石桥，然后卡住，变成一段沙沙的空白。门慢慢合上了。",
      "第七节的最后一排空了。座位是凉的——一直都是凉的。"
    ],
    effects: { clue: 2 },
    choices: [{ label: "回车头，把本子锁进抽屉", why: "", to: "endHold" }]
  },

  endKeeper: { end: "结局 · 守夜人", text: ["终点站到了。你把本子交给下一班的人，什么也没多说。", "有些差事就是这样：做得好，就等于什么都没发生。"] },
  endTear: { end: "结局 · 撕页", text: ["那一页被你撕下来，塞进外套口袋。", "第二天早上，口袋是空的。第七节的末排，坐着一个眼熟的人——穿着你昨晚的外套。"] },
  endDown: { end: "结局 · 青石桥", text: ["你下了车。站台的风是热的，像有人在你耳边呼气。", "身后车门合拢，车走了。你回头，牌子上的字已经变了——写的是你的名字。"] },
  endHold: { end: "结局 · 空座", text: ["从那晚起，第七节的末排永远空着，谁坐都会站起来。", "而每次数人头，你数出来的都比上车的少一个。少的那个是谁，你不敢往下想。"] }
};

// ---- 平台交互：存档只能走 postMessage（沙箱里没有 localStorage） ----
function save() { parent.postMessage({ type: "wgp:save", data: S }, "*"); }
function clearSave() { parent.postMessage({ type: "wgp:clear" }, "*"); }

window.addEventListener("message", function (e) {
  var d = e.data;
  if (!d || d.type !== "wgp:loaded") return;
  if (d.data && d.data.at && SCENES[d.data.at]) S = d.data;
  render();
});

// ---- 渲染 ----
function el(tag, cls, text) {
  var n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text) n.textContent = text;
  return n;
}

function render() {
  var sc = SCENES[S.at] || SCENES.start;
  document.getElementById("stop").textContent = S.stop;
  document.getElementById("wake").textContent = S.wake;
  document.getElementById("clue").textContent = S.clue;

  var scene = document.getElementById("scene");
  scene.innerHTML = "";
  if (sc.end) scene.appendChild(el("p", "ending", sc.end));
  sc.text.forEach(function (t, i) {
    var p = el("p", "fade", t);
    p.style.animationDelay = i * 0.09 + "s";
    scene.appendChild(p);
  });

  var box = document.getElementById("choices");
  box.innerHTML = "";
  if (sc.end) {
    var again = el("button", "choice", "再坐一次末班车");
    again.type = "button";
    again.onclick = function () { S = { stop: 0, wake: 10, clue: 0, at: "start", seen: {} }; clearSave(); render(); };
    box.appendChild(again);
    document.getElementById("saveHint").textContent = "这一趟到此为止。线索 " + S.clue + " 条。";
    return;
  }
  sc.choices.forEach(function (c) {
    var b = el("button", "choice");
    b.type = "button";
    b.appendChild(document.createTextNode(c.label));
    if (c.why) b.appendChild(el("span", "why", c.why));
    b.onclick = function () { go(c); };
    box.appendChild(b);
  });
  document.getElementById("saveHint").textContent = "存档已保留，关掉再回来接着走。";
}

function go(c) {
  var next = SCENES[c.to];
  S.at = c.to;
  S.stop += 1;
  S.seen[c.to] = true;
  if (next && next.effects) {
    if (next.effects.clue) S.clue += next.effects.clue;
    if (next.effects.wake) S.wake += next.effects.wake;
    if (S.wake < 0) S.wake = 0;
  }
  save();
  render();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

document.getElementById("reset").onclick = function () {
  S = { stop: 0, wake: 10, clue: 0, at: "start", seen: {} };
  clearSave();
  render();
};

// 起来了吱一声，外壳好把载入遮罩收掉；然后要一次存档
parent.postMessage({ type: "wgp:ready" }, "*");
parent.postMessage({ type: "wgp:load" }, "*");
render();
