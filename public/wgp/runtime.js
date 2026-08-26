/*!
 * 字游 · 自由模式运行库（WGP）
 *
 * 这是平台替创作者垫在下面的一层地基。自由模式的作品自带代码、跑在沙箱 iframe 里，
 * 于是每一部作品都要重新解决同一批问题：存档怎么存、界面怎么切、随机数怎么可复现、
 * 表格进度条怎么画、手机上怎么不溢出。让 AI 每次从零写这些，既烧 token 又容易写错
 * ——沙箱里浏览器本地存储一概读不到、外发请求被 CSP 掐死，这两个坑几乎人人踩一遍。
 *
 * 所以把它们做成库：作品里一行 <script src="wgp.js"></script> 就有了。
 * 平台在 /play/:id/ 下虚拟出这个文件，作品不必自带；作者要是写了同名文件，以他的为准。
 *
 * 约定：
 * - 纯 ES2017，不依赖任何外部包，不发任何网络请求
 * - 只挂一个全局 window.WGP
 * - 所有跟平台打交道的动作（存档）都走 postMessage，别处不碰
 */
(function () {
  "use strict";
  if (window.WGP) return;

  var VERSION = "1.0.0";

  /* ── 一、存档：沙箱里唯一能落盘的路 ───────────────────────────────
   * iframe 是不透明源，浏览器自带的那几种本地存储读不到、也不该读（换设备就没了）。
   * 平台在外壳里代管存档，这里只负责把话说对：
   *   wgp:ready  我起来了
   *   wgp:load   把存档给我  → 外壳回 wgp:loaded {data}
   *   wgp:save   存这个
   *   wgp:clear  删掉
   */
  var saveTimer = null;
  var readyFns = [];
  var loaded = false;
  var loadedData = null;

  function post(type, data) {
    try {
      parent.postMessage(data === undefined ? { type: type } : { type: type, data: data }, "*");
    } catch (e) {
      /* 外壳不在（比如作者直接开文件看）——不该因此崩掉游戏 */
    }
  }

  function fireReady() {
    if (loaded) return;
    loaded = true;
    var fns = readyFns;
    readyFns = [];
    for (var i = 0; i < fns.length; i++) {
      try {
        fns[i](loadedData);
      } catch (e) {
        console.error("[WGP] ready 回调出错：", e);
      }
    }
  }

  window.addEventListener("message", function (e) {
    var m = e.data;
    if (!m || typeof m !== "object") return;
    if (m.type === "wgp:loaded") {
      loadedData = m.data == null ? null : m.data;
      fireReady();
    }
  });

  /**
   * 等平台把存档送回来再开工。
   * fn(存档 或 null)。外壳不在、或 1.5 秒没回，也照样调一次（data=null），
   * 免得作品卡在加载页——宁可从头开始，也不能打不开。
   */
  function ready(fn) {
    if (typeof fn !== "function") return;
    if (loaded) {
      fn(loadedData);
      return;
    }
    readyFns.push(fn);
  }

  function save(obj) {
    post("wgp:save", obj);
  }

  /** 防抖存档：连点、拖滑条这种场景别一秒发二十条 */
  function saveLater(obj, ms) {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      saveTimer = null;
      save(obj);
    }, typeof ms === "number" ? ms : 800);
  }

  function clearSave() {
    post("wgp:clear");
  }

  /* ── 二、随机数：可复现 ─────────────────────────────────────────
   * Math.random() 存不进存档，也就意味着「读档重打同一场比赛」结果会变。
   * 经营/成长类作品这一点很要命，所以给一个带种子的：种子存进存档，读档即复现。
   */
  function rng(seed) {
    var s = typeof seed === "number" ? seed >>> 0 : hashStr(String(seed == null ? "wgp" : seed));
    function next() {
      // mulberry32：短、够用、结果稳定
      s = (s + 0x6d2b79f5) >>> 0;
      var t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }
    var api = {
      /** 当前种子——存进存档，下次 WGP.rng(存档.seed) 就接得上 */
      get seed() {
        return s;
      },
      float: next,
      /** [min, max] 闭区间整数 */
      int: function (min, max) {
        return Math.floor(next() * (max - min + 1)) + min;
      },
      chance: function (p) {
        return next() < p;
      },
      pick: function (arr) {
        return arr[Math.floor(next() * arr.length)];
      },
      /** 按权重抽：weights 缺省时看 item.weight，再缺省就等权 */
      weighted: function (arr, weights) {
        var w = [];
        var total = 0;
        for (var i = 0; i < arr.length; i++) {
          var x = weights ? weights[i] : arr[i] && arr[i].weight;
          x = typeof x === "number" && x > 0 ? x : 1;
          w.push(x);
          total += x;
        }
        var r = next() * total;
        for (var j = 0; j < arr.length; j++) {
          r -= w[j];
          if (r <= 0) return arr[j];
        }
        return arr[arr.length - 1];
      },
      /** 洗牌（返回新数组，不动原数组） */
      shuffle: function (arr) {
        var a = arr.slice();
        for (var i = a.length - 1; i > 0; i--) {
          var k = Math.floor(next() * (i + 1));
          var t = a[i];
          a[i] = a[k];
          a[k] = t;
        }
        return a;
      },
    };
    return api;
  }

  function hashStr(str) {
    var h = 2166136261;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  /* ── 三、DOM 构造：不用模板字符串拼 HTML ──────────────────────────
   * 拼字符串最容易在玩家自己起的名字上翻车（一个 < 就把界面拆了）。
   * el() 走的是 textContent，天生不会被内容改结构。
   */
  function el(tag, props, children) {
    var node = document.createElement(tag || "div");
    if (props && typeof props === "object" && !isNode(props) && !Array.isArray(props)) {
      for (var k in props) {
        if (!Object.prototype.hasOwnProperty.call(props, k)) continue;
        var v = props[k];
        if (v == null || v === false) continue;
        if (k === "class" || k === "className") node.className = String(v);
        else if (k === "style" && typeof v === "object") {
          for (var sk in v) if (Object.prototype.hasOwnProperty.call(v, sk)) node.style[sk] = v[sk];
        } else if (k === "text") node.textContent = String(v);
        else if (k === "html") node.innerHTML = String(v);
        else if (k === "dataset" && typeof v === "object") {
          for (var dk in v) if (Object.prototype.hasOwnProperty.call(v, dk)) node.dataset[dk] = v[dk];
        } else if (k.slice(0, 2) === "on" && typeof v === "function") {
          node.addEventListener(k.slice(2).toLowerCase(), v);
        } else node.setAttribute(k, v === true ? "" : String(v));
      }
    } else if (children === undefined) {
      children = props;
    }
    append(node, children);
    return node;
  }

  function isNode(x) {
    return x && typeof x === "object" && typeof x.nodeType === "number";
  }

  function append(parent, child) {
    if (child == null || child === false) return parent;
    if (Array.isArray(child)) {
      for (var i = 0; i < child.length; i++) append(parent, child[i]);
      return parent;
    }
    parent.appendChild(isNode(child) ? child : document.createTextNode(String(child)));
    return parent;
  }

  function clear(node) {
    while (node && node.firstChild) node.removeChild(node.firstChild);
    return node;
  }

  function resolve(target) {
    if (!target) return null;
    return typeof target === "string" ? document.querySelector(target) : target;
  }

  /* ── 四、界面切换：26 个界面也不用手写路由 ─────────────────────── */
  var screens = {};
  var root = null;
  var stack = [];
  var navBar = null;
  var navItems = [];

  function mount(target) {
    root = resolve(target) || document.body;
    root.classList.add("wgp-root");
    return root;
  }

  /** 注册一个界面：render(容器, 参数) */
  function screen(name, render) {
    screens[name] = render;
  }

  function go(name, params) {
    if (!screens[name]) {
      console.error("[WGP] 没有注册过的界面：" + name);
      return;
    }
    if (!root) mount(document.body);
    var last = stack[stack.length - 1];
    if (!last || last.name !== name) stack.push({ name: name, params: params });
    else stack[stack.length - 1] = { name: name, params: params };
    paint();
  }

  /** 就地重画当前界面——数值改了之后调它，不用自己收集要更新的节点 */
  function refresh() {
    if (stack.length) paint();
  }

  function back() {
    if (stack.length > 1) {
      stack.pop();
      paint();
    }
  }

  function current() {
    var top = stack[stack.length - 1];
    return top ? top.name : null;
  }

  function paint() {
    var top = stack[stack.length - 1];
    if (!top || !root) return;
    var host = root.querySelector(".wgp-screen");
    if (!host) {
      host = el("div", { class: "wgp-screen" });
      root.appendChild(host);
    }
    clear(host);
    host.scrollTop = 0;
    try {
      var out = screens[top.name](host, top.params || {});
      if (out !== undefined && out !== host) append(host, out);
    } catch (e) {
      console.error("[WGP] 画界面 " + top.name + " 出错：", e);
      append(host, el("div", { class: "wgp-error", text: "这一页出错了：" + (e && e.message) }));
    }
    syncNav();
  }

  /** 顶部导航条：[{name:"squad", label:"阵容"}, …] */
  function nav(items) {
    navItems = items || [];
    if (!root) mount(document.body);
    if (!navBar) {
      navBar = el("nav", { class: "wgp-nav" });
      root.insertBefore(navBar, root.firstChild);
    }
    clear(navBar);
    navItems.forEach(function (it) {
      navBar.appendChild(
        el("button", {
          type: "button",
          class: "wgp-nav-item",
          text: it.label || it.name,
          dataset: { screen: it.name },
          onClick: function () {
            go(it.name, it.params);
          },
        })
      );
    });
    syncNav();
    return navBar;
  }

  function syncNav() {
    if (!navBar) return;
    var now = current();
    var kids = navBar.children;
    for (var i = 0; i < kids.length; i++) {
      kids[i].classList.toggle("is-on", kids[i].dataset.screen === now);
    }
  }

  /* ── 五、界面积木 ─────────────────────────────────────────────── */
  var ui = {
    /** 一块带标题的面板 */
    panel: function (title, body, opts) {
      opts = opts || {};
      var head = el("div", { class: "wgp-panel-head" }, [
        el("span", { class: "wgp-panel-title", text: title }),
        opts.aside ? el("span", { class: "wgp-panel-aside" }, opts.aside) : null,
      ]);
      return el("section", { class: "wgp-panel" + (opts.class ? " " + opts.class : "") }, [
        title ? head : null,
        el("div", { class: "wgp-panel-body" }, body),
      ]);
    },

    /** 一格数值：标签 + 数字 + 小注 */
    stat: function (label, value, hint) {
      return el("div", { class: "wgp-stat" }, [
        el("div", { class: "wgp-stat-label", text: label }),
        el("div", { class: "wgp-stat-value", text: String(value) }),
        hint ? el("div", { class: "wgp-stat-hint", text: hint }) : null,
      ]);
    },

    /** 一排数值 */
    stats: function (list) {
      return el(
        "div",
        { class: "wgp-stats" },
        (list || []).map(function (s) {
          return ui.stat(s.label, s.value, s.hint);
        })
      );
    },

    /** 进度条／能力条。opts: {label, text, tone:"ok|warn|bad", max} */
    bar: function (value, max, opts) {
      opts = opts || {};
      var top = typeof max === "number" && max > 0 ? max : 100;
      var pct = Math.max(0, Math.min(100, (value / top) * 100));
      return el("div", { class: "wgp-bar" + (opts.tone ? " tone-" + opts.tone : "") }, [
        opts.label || opts.text
          ? el("div", { class: "wgp-bar-head" }, [
              opts.label ? el("span", { text: opts.label }) : null,
              el("span", { class: "wgp-bar-num", text: opts.text != null ? String(opts.text) : String(value) }),
            ])
          : null,
        el("div", { class: "wgp-bar-track" }, el("div", { class: "wgp-bar-fill", style: { width: pct + "%" } })),
      ]);
    },

    /**
     * 表格。518 名选手就是靠它排的。
     * cols: [{key, label, align, width, render(row)}]
     * opts: {onRow(row), sortable:true, empty:"没有数据", max:100}
     */
    table: function (cols, rows, opts) {
      opts = opts || {};
      cols = cols || [];
      rows = rows || [];
      var sortKey = opts.sortKey || null;
      var sortDesc = opts.sortDesc !== false;
      var wrap = el("div", { class: "wgp-table-wrap" });

      function cellValue(row, col) {
        return typeof col.value === "function" ? col.value(row) : row[col.key];
      }

      function build() {
        clear(wrap);
        var data = rows.slice();
        if (sortKey) {
          var col = cols.filter(function (c) {
            return c.key === sortKey;
          })[0];
          if (col) {
            data.sort(function (a, b) {
              var x = cellValue(a, col);
              var y = cellValue(b, col);
              if (typeof x === "number" && typeof y === "number") return sortDesc ? y - x : x - y;
              return sortDesc ? String(y).localeCompare(String(x), "zh") : String(x).localeCompare(String(y), "zh");
            });
          }
        }
        if (typeof opts.max === "number") data = data.slice(0, opts.max);
        if (!data.length) {
          wrap.appendChild(el("div", { class: "wgp-empty", text: opts.empty || "暂时没有内容" }));
          return;
        }
        var thead = el(
          "tr",
          {},
          cols.map(function (c) {
            return el("th", {
              class: (c.align ? "align-" + c.align : "") + (opts.sortable ? " sortable" : "") + (sortKey === c.key ? " is-sorted" : ""),
              style: c.width ? { width: c.width } : null,
              text: c.label != null ? c.label : c.key,
              onClick: opts.sortable
                ? function () {
                    if (sortKey === c.key) sortDesc = !sortDesc;
                    else {
                      sortKey = c.key;
                      sortDesc = true;
                    }
                    build();
                  }
                : null,
            });
          })
        );
        var tbody = el(
          "tbody",
          {},
          data.map(function (row) {
            return el(
              "tr",
              {
                class: opts.onRow ? "clickable" : null,
                onClick: opts.onRow
                  ? function () {
                      opts.onRow(row);
                    }
                  : null,
              },
              cols.map(function (c) {
                var v = c.render ? c.render(row) : cellValue(row, c);
                return el("td", { class: c.align ? "align-" + c.align : null }, isNode(v) ? v : v == null ? "" : String(v));
              })
            );
          })
        );
        wrap.appendChild(el("table", { class: "wgp-table" }, [el("thead", {}, thead), tbody]));
      }
      build();
      return wrap;
    },

    /** 一排按钮。list: [{label, onPick, disabled, hint, tone}] */
    actions: function (list) {
      return el(
        "div",
        { class: "wgp-actions" },
        (list || []).map(function (a) {
          return el("button", {
            type: "button",
            class: "wgp-btn" + (a.tone ? " tone-" + a.tone : ""),
            disabled: a.disabled ? true : null,
            title: a.hint || null,
            onClick: function () {
              if (!a.disabled && a.onPick) a.onPick(a);
            },
          }, [el("span", { text: a.label }), a.hint ? el("small", { text: a.hint }) : null]);
        })
      );
    },

    /** 弹层。actions: [{label, onPick, tone}]；onPick 返回 false 就不关 */
    modal: function (opts) {
      opts = opts || {};
      var mask = el("div", { class: "wgp-mask" });
      function close() {
        if (mask.parentNode) mask.parentNode.removeChild(mask);
      }
      var box = el("div", { class: "wgp-modal" }, [
        opts.title ? el("div", { class: "wgp-modal-head", text: opts.title }) : null,
        el("div", { class: "wgp-modal-body" }, opts.body),
        el(
          "div",
          { class: "wgp-modal-foot" },
          (opts.actions || [{ label: "知道了" }]).map(function (a) {
            return el("button", {
              type: "button",
              class: "wgp-btn" + (a.tone ? " tone-" + a.tone : ""),
              text: a.label,
              onClick: function () {
                if (a.onPick && a.onPick() === false) return;
                close();
              },
            });
          })
        ),
      ]);
      mask.appendChild(box);
      if (opts.dismissable !== false) {
        mask.addEventListener("click", function (e) {
          if (e.target === mask) close();
        });
      }
      document.body.appendChild(mask);
      return { close: close, el: box };
    },

    confirm: function (message, opts) {
      opts = opts || {};
      return new Promise(function (done) {
        ui.modal({
          title: opts.title || "确认",
          body: el("p", { text: message }),
          dismissable: false,
          actions: [
            { label: opts.cancel || "再想想", onPick: function () { done(false); } },
            { label: opts.ok || "就这么办", tone: "primary", onPick: function () { done(true); } },
          ],
        });
      });
    },

    /** 一闪而过的提示 */
    toast: function (message, ms) {
      var host = document.querySelector(".wgp-toasts");
      if (!host) {
        host = el("div", { class: "wgp-toasts" });
        document.body.appendChild(host);
      }
      var t = el("div", { class: "wgp-toast", text: message });
      host.appendChild(t);
      setTimeout(function () {
        t.classList.add("out");
        setTimeout(function () {
          if (t.parentNode) t.parentNode.removeChild(t);
        }, 300);
      }, typeof ms === "number" ? ms : 1800);
      return t;
    },
  };

  /* ── 六、文字流：打字机 + 选项 ─────────────────────────────────
   * 文字游戏的主心骨。say() 返回 Promise，可以 await 着一句句往下走；
   * 打字途中点一下就把这句补全——玩家不该被动画绑住。
   */
  function text(container, opts) {
    var host = resolve(container) || document.body;
    host.classList.add("wgp-stream");
    opts = opts || {};
    var speed = typeof opts.speed === "number" ? opts.speed : 28; // 每秒字数的倒数（毫秒/字）
    var skipping = false;

    host.addEventListener("click", function () {
      skipping = true;
    });

    function scroll() {
      host.scrollTop = host.scrollHeight;
    }

    var api = {
      /** 加一句。opts: {speed, class, instant, into} */
      say: function (str, o) {
        o = o || {};
        var line = el("p", { class: "wgp-line" + (o.class ? " " + o.class : "") });
        (o.into || host).appendChild(line);
        scroll();
        var full = String(str == null ? "" : str);
        if (o.instant || speed <= 0) {
          line.textContent = full;
          scroll();
          return Promise.resolve(line);
        }
        skipping = false;
        return new Promise(function (done) {
          var i = 0;
          var per = typeof o.speed === "number" ? o.speed : speed;
          var timer = setInterval(function () {
            if (skipping) {
              line.textContent = full;
              clearInterval(timer);
              scroll();
              done(line);
              return;
            }
            i += 1;
            line.textContent = full.slice(0, i);
            scroll();
            if (i >= full.length) {
              clearInterval(timer);
              done(line);
            }
          }, per);
        });
      },

      /** 一段带说话人的台词：名字单起一行，正文照样打字机 */
      speak: function (who, str, o) {
        var wrap = el("div", { class: "wgp-say" }, el("div", { class: "wgp-who", text: who }));
        host.appendChild(wrap);
        var oo = {};
        for (var k in o || {}) if (Object.prototype.hasOwnProperty.call(o, k)) oo[k] = o[k];
        oo.into = wrap;
        return api.say(str, oo);
      },

      /** 出选项，返回玩家选中的那一项 */
      choices: function (list) {
        return new Promise(function (done) {
          var box = el(
            "div",
            { class: "wgp-choices" },
            (list || []).map(function (c) {
              return el("button", {
                type: "button",
                class: "wgp-choice" + (c.disabled ? " is-off" : ""),
                disabled: c.disabled ? true : null,
                onClick: function () {
                  if (c.disabled) return;
                  box.parentNode && box.parentNode.removeChild(box);
                  if (c.echo !== false) api.say(c.label, { instant: true, class: "wgp-echo" });
                  if (c.onPick) c.onPick(c);
                  done(c);
                },
              }, [el("span", { text: c.label }), c.hint ? el("small", { text: c.hint }) : null]);
            })
          );
          host.appendChild(box);
          scroll();
        });
      },

      clear: function () {
        clear(host);
      },
      el: host,
    };
    return api;
  }

  /* ── 七、零碎 ─────────────────────────────────────────────────── */
  var fmt = {
    num: function (n) {
      return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    },
    pct: function (n, digits) {
      return (n * 100).toFixed(digits == null ? 0 : digits) + "%";
    },
    money: function (n, unit) {
      return (unit || "¥") + fmt.num(n);
    },
    clamp: function (n, lo, hi) {
      return Math.max(lo, Math.min(hi, n));
    },
  };

  function wait(ms) {
    return new Promise(function (done) {
      setTimeout(done, ms);
    });
  }

  window.WGP = {
    version: VERSION,
    ready: ready,
    save: save,
    saveLater: saveLater,
    clearSave: clearSave,
    rng: rng,
    el: el,
    h: el,
    clear: clear,
    mount: mount,
    screen: screen,
    go: go,
    back: back,
    refresh: refresh,
    current: current,
    nav: nav,
    ui: ui,
    text: text,
    fmt: fmt,
    wait: wait,
  };

  // 起手就跟外壳握手；外壳不在或迟迟不回，1.5 秒后照样让作品跑起来
  post("wgp:ready");
  post("wgp:load");
  setTimeout(fireReady, 1500);
})();
