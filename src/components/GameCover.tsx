// 游戏封面：三级来源——作者上传的自定义图 > 素材库预设（手绘 SVG 插画）> 按 id 确定性渐变兜底。
// 全部 SVG 内联、无外部资产；官方游戏按 id 映射到专属主题预设。
// 注意：所有随机点位用固定种子预生成（模块加载时算好），保证 SSR/CSR 渲染一致。

const PALETTES: [string, string][] = [
  ["#1e3a8a", "#7c3aed"],
  ["#0f766e", "#4d7c0f"],
  ["#9d174d", "#b45309"],
  ["#312e81", "#0369a1"],
  ["#7f1d1d", "#c2410c"],
  ["#14532d", "#0e7490"],
  ["#581c87", "#be185d"],
  ["#0c4a6e", "#047857"],
];

const KIND_ICON: Record<string, string> = {
  sim: "🏆",
  life: "🎲",
  story: "📖",
  unknown: "🎮",
  flagship: "⭐",
};

function hashOf(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

/** 固定种子的伪随机序列：装饰点位（雨丝/星星/花瓣）预生成，SSR 安全 */
function seq(seed: number, n: number): number[] {
  const out: number[] = [];
  let x = seed >>> 0 || 1;
  for (let i = 0; i < n; i++) {
    x = (x * 1664525 + 1013904223) >>> 0;
    out.push(x / 0xffffffff);
  }
  return out;
}

const RAIN = seq(7, 120);
const STARS = seq(21, 90);
const PETALS = seq(35, 48);
const WINDOWS = seq(49, 160);
const CONFETTI = seq(63, 60);

interface PresetDef {
  label: string;
  render: (uid: string) => React.ReactElement;
}

const VB = { viewBox: "0 0 640 360", preserveAspectRatio: "xMidYMid slice" as const, width: "100%", height: "100%" };
const abs: React.CSSProperties = { position: "absolute", inset: 0 };

export const COVER_PRESETS: Record<string, PresetDef> = {
  xianxia: {
    label: "修仙 · 青山问道",
    render: (u) => (
      <svg {...VB} style={abs} aria-hidden>
        <defs>
          <linearGradient id={`${u}-sky`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#0b2038" />
            <stop offset="1" stopColor="#155e63" />
          </linearGradient>
        </defs>
        <rect width="640" height="360" fill={`url(#${u}-sky)`} />
        <circle cx="500" cy="86" r="46" fill="#f5efdc" opacity="0.92" />
        <circle cx="500" cy="86" r="66" fill="#f5efdc" opacity="0.12" />
        <path d="M0 240 L90 140 L170 230 L260 150 L350 250 L640 210 L640 360 L0 360 Z" fill="#0e3a45" />
        <path d="M0 290 L120 210 L230 290 L360 220 L500 300 L640 260 L640 360 L0 360 Z" fill="#0a2b35" />
        <path d="M0 330 L180 270 L340 330 L520 285 L640 320 L640 360 L0 360 Z" fill="#071e26" />
        <rect x="0" y="252" width="640" height="14" fill="#cfe8e3" opacity="0.1" />
        <rect x="60" y="286" width="520" height="10" fill="#cfe8e3" opacity="0.08" />
        <path d="M120 96 q14 -14 30 -6 q-10 2 -14 8 q16 -4 26 6 q-14 0 -22 6 l-20 -2 Z" fill="#f0ece0" opacity="0.9" />
        <path d="M168 122 q10 -10 22 -5 q-8 2 -10 6 q12 -2 18 5 q-10 0 -16 4 l-14 -2 Z" fill="#e6e0d0" opacity="0.75" />
        <path d="M210 300 L470 120" stroke="#dff3ef" strokeWidth="2.5" opacity="0.7" />
        <path d="M452 112 l26 14 l-18 6 Z" fill="#dff3ef" opacity="0.85" />
      </svg>
    ),
  },
  "night-bus": {
    label: "怪谈 · 雨夜末班车",
    render: (u) => (
      <svg {...VB} style={abs} aria-hidden>
        <defs>
          <linearGradient id={`${u}-sky`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#060a18" />
            <stop offset="1" stopColor="#101c38" />
          </linearGradient>
          <linearGradient id={`${u}-beam`} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#ffe9a8" stopOpacity="0.55" />
            <stop offset="1" stopColor="#ffe9a8" stopOpacity="0" />
          </linearGradient>
        </defs>
        <rect width="640" height="360" fill={`url(#${u}-sky)`} />
        <rect x="0" y="284" width="640" height="76" fill="#05070f" />
        <circle cx="86" cy="84" r="30" fill="#fff6cf" opacity="0.14" />
        <rect x="83" y="84" width="6" height="200" fill="#1b2742" />
        <circle cx="86" cy="84" r="10" fill="#ffedb0" opacity="0.95" />
        <g>
          <rect x="330" y="150" width="250" height="128" rx="14" fill="#20304f" />
          <rect x="330" y="150" width="250" height="46" rx="14" fill="#2a3c60" />
          <rect x="344" y="166" width="52" height="34" rx="4" fill="#ffd98a" opacity="0.95" />
          <rect x="406" y="166" width="52" height="34" rx="4" fill="#ffd98a" opacity="0.8" />
          <rect x="468" y="166" width="52" height="34" rx="4" fill="#41597f" />
          <rect x="530" y="166" width="38" height="34" rx="4" fill="#ffd98a" opacity="0.6" />
          <rect x="344" y="216" width="224" height="30" rx="4" fill="#16233d" />
          <text x="356" y="238" fill="#ff5d5d" fontSize="19" fontFamily="monospace" opacity="0.9">
            末班 · 13 路
          </text>
          <circle cx="352" cy="266" r="13" fill="#0c1322" stroke="#3c516f" strokeWidth="3" />
          <circle cx="548" cy="266" r="13" fill="#0c1322" stroke="#3c516f" strokeWidth="3" />
          <rect x="322" y="250" width="10" height="12" rx="2" fill="#ff6363" opacity="0.9" />
          <path d="M330 262 L210 250 L210 286 L330 278 Z" fill={`url(#${u}-beam)`} transform="rotate(180 270 268)" />
        </g>
        {RAIN.map((r, i) =>
          i % 2 === 0 ? (
            <line
              key={i}
              x1={r * 660 - 10}
              y1={(RAIN[(i + 1) % RAIN.length] * 300) | 0}
              x2={r * 660 - 16}
              y2={((RAIN[(i + 1) % RAIN.length] * 300) | 0) + 22}
              stroke="#8fa8d8"
              strokeWidth="1.2"
              opacity={0.16 + (i % 5) * 0.06}
            />
          ) : null
        )}
        <rect x="340" y="292" width="230" height="8" rx="4" fill="#ffd98a" opacity="0.08" />
        <rect x="60" y="296" width="60" height="6" rx="3" fill="#fff6cf" opacity="0.1" />
      </svg>
    ),
  },
  esports: {
    label: "电竞 · 荣耀之巅",
    render: (u) => (
      <svg {...VB} style={abs} aria-hidden>
        <defs>
          <linearGradient id={`${u}-bg`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#0d1226" />
            <stop offset="1" stopColor="#221037" />
          </linearGradient>
          <linearGradient id={`${u}-cup`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#ffe6a3" />
            <stop offset="1" stopColor="#d99a2b" />
          </linearGradient>
        </defs>
        <rect width="640" height="360" fill={`url(#${u}-bg)`} />
        <polygon points="0,0 150,0 40,360 0,360" fill="#ff4655" opacity="0.14" />
        <polygon points="640,0 520,0 610,360 640,360" fill="#3a6df0" opacity="0.16" />
        <polygon points="180,0 320,180 120,360 60,360 260,180 140,0" fill="#ffffff" opacity="0.04" />
        <polygon points="300,0 260,110 380,110 340,0" fill="#f8f8ff" opacity="0.05" />
        <polygon points="250,0 330,240 410,0" fill="#fffbe8" opacity="0.06" />
        <ellipse cx="320" cy="312" rx="180" ry="18" fill="#000" opacity="0.4" />
        <ellipse cx="320" cy="306" rx="130" ry="12" fill="#8f6bff" opacity="0.25" />
        <g>
          <path d="M282 170 q-40 6 -40 -34 l14 0 q-2 26 26 22 Z" fill={`url(#${u}-cup)`} />
          <path d="M358 170 q40 6 40 -34 l-14 0 q2 26 -26 22 Z" fill={`url(#${u}-cup)`} />
          <path d="M276 128 h88 v34 a44 40 0 0 1 -88 0 Z" fill={`url(#${u}-cup)`} />
          <rect x="308" y="200" width="24" height="26" fill="#d99a2b" />
          <rect x="292" y="226" width="56" height="14" rx="3" fill="#b57b1d" />
          <rect x="284" y="240" width="72" height="16" rx="3" fill="#8a5c13" />
          <circle cx="320" cy="150" r="10" fill="#fff" opacity="0.5" />
        </g>
        {CONFETTI.map((c, i) => (
          <rect
            key={i}
            x={c * 640}
            y={CONFETTI[(i + 7) % CONFETTI.length] * 200}
            width="5"
            height="8"
            rx="1"
            fill={["#ff4655", "#3a6df0", "#ffd98a", "#7ef0c9"][i % 4]}
            opacity="0.7"
            transform={`rotate(${(c * 90) | 0} ${c * 640} ${CONFETTI[(i + 7) % CONFETTI.length] * 200})`}
          />
        ))}
      </svg>
    ),
  },
  romance: {
    label: "恋爱 · 心动信号",
    render: (u) => (
      <svg {...VB} style={abs} aria-hidden>
        <defs>
          <linearGradient id={`${u}-sky`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#ff9db0" />
            <stop offset="0.6" stopColor="#ffd3c0" />
            <stop offset="1" stopColor="#ffeede" />
          </linearGradient>
        </defs>
        <rect width="640" height="360" fill={`url(#${u}-sky)`} />
        <circle cx="330" cy="230" r="60" fill="#fff3d6" opacity="0.9" />
        <path d="M0 300 L60 288 L120 298 L200 282 L290 296 L380 284 L470 296 L560 286 L640 296 L640 360 L0 360 Z" fill="#c67c96" opacity="0.55" />
        <path d="M0 320 L640 310 L640 360 L0 360 Z" fill="#a75b7f" opacity="0.8" />
        <path d="M-10 40 q120 30 150 130 q8 -60 -20 -110 q60 60 60 150" stroke="#8c4a63" strokeWidth="10" fill="none" strokeLinecap="round" opacity="0.85" />
        {PETALS.map((p, i) => (
          <ellipse
            key={i}
            cx={p * 640}
            cy={PETALS[(i + 5) % PETALS.length] * 320}
            rx="7"
            ry="4"
            fill={i % 3 ? "#ff8fae" : "#ffc3d4"}
            opacity="0.85"
            transform={`rotate(${(p * 120) | 0} ${p * 640} ${PETALS[(i + 5) % PETALS.length] * 320})`}
          />
        ))}
        <path d="M520 96 c8 -16 32 -10 32 6 c0 12 -18 22 -32 32 c-14 -10 -32 -20 -32 -32 c0 -16 24 -22 32 -6 Z" fill="#ff5f87" opacity="0.9" />
      </svg>
    ),
  },
  wuxia: {
    label: "武侠 · 江湖夜雨",
    render: (u) => (
      <svg {...VB} style={abs} aria-hidden>
        <defs>
          <linearGradient id={`${u}-paper`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#efe6d2" />
            <stop offset="1" stopColor="#ded0b4" />
          </linearGradient>
        </defs>
        <rect width="640" height="360" fill={`url(#${u}-paper)`} />
        <circle cx="480" cy="100" r="44" fill="#c0392b" opacity="0.85" />
        <path d="M0 230 Q120 130 240 226 T520 214 T640 224 L640 250 L0 250 Z" fill="#4a453c" opacity="0.8" />
        <path d="M60 236 Q180 168 300 234" stroke="#332f28" strokeWidth="8" fill="none" opacity="0.5" strokeLinecap="round" />
        <rect x="0" y="252" width="640" height="108" fill="#a99f88" opacity="0.5" />
        <path d="M0 262 L640 258" stroke="#6d6350" strokeWidth="2" opacity="0.5" />
        <g opacity="0.9">
          <path d="M300 300 q60 -16 120 0 l-8 10 q-52 -12 -104 0 Z" fill="#2f2b24" />
          <rect x="352" y="270" width="8" height="26" fill="#2f2b24" />
          <path d="M356 252 a10 10 0 1 1 0.1 0" fill="#2f2b24" />
          <path d="M340 262 q16 14 34 2" stroke="#2f2b24" strokeWidth="5" fill="none" strokeLinecap="round" />
          <path d="M368 262 L420 236" stroke="#2f2b24" strokeWidth="3.4" strokeLinecap="round" />
        </g>
        <path d="M96 292 q4 -30 0 -58 M110 292 q6 -26 2 -50 M124 292 q2 -20 0 -40" stroke="#5d5545" strokeWidth="3" fill="none" opacity="0.7" strokeLinecap="round" />
        <rect x="560" y="270" width="34" height="34" fill="#c0392b" opacity="0.85" rx="4" />
        <text x="565" y="296" fontSize="24" fill="#efe6d2" fontFamily="serif">
          侠
        </text>
      </svg>
    ),
  },
  city: {
    label: "都市 · 霓虹不眠",
    render: (u) => (
      <svg {...VB} style={abs} aria-hidden>
        <defs>
          <linearGradient id={`${u}-sky`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#0c0f26" />
            <stop offset="1" stopColor="#2b1a4d" />
          </linearGradient>
        </defs>
        <rect width="640" height="360" fill={`url(#${u}-sky)`} />
        {[
          [20, 150, 70, 210, "#161a38"],
          [100, 96, 84, 264, "#1b2044"],
          [196, 170, 60, 190, "#161a38"],
          [266, 120, 90, 240, "#20264f"],
          [366, 190, 66, 170, "#161a38"],
          [442, 84, 96, 276, "#1b2044"],
          [548, 150, 74, 210, "#20264f"],
        ].map(([x, y, w, h, f], bi) => (
          <g key={bi}>
            <rect x={x as number} y={y as number} width={w as number} height={h as number} fill={f as string} />
            {WINDOWS.slice(bi * 20, bi * 20 + 20).map((wv, i) => (
              <rect
                key={i}
                x={(x as number) + 8 + (i % 4) * (((w as number) - 16) / 4)}
                y={(y as number) + 10 + Math.floor(i / 4) * 26}
                width="9"
                height="12"
                fill={wv > 0.45 ? "#ffd98a" : "#33406e"}
                opacity={wv > 0.45 ? 0.9 : 0.8}
              />
            ))}
          </g>
        ))}
        <rect x="238" y="60" width="10" height="60" fill="#20264f" />
        <circle cx="243" cy="54" r="5" fill="#ff5d8f" />
        <rect x="300" y="150" width="44" height="16" rx="3" fill="#ff2d78" opacity="0.85" />
        <rect x="470" y="120" width="16" height="44" rx="3" fill="#2de1ff" opacity="0.8" />
        <rect x="0" y="336" width="640" height="24" fill="#05060f" />
        <rect x="290" y="342" width="60" height="4" rx="2" fill="#ff2d78" opacity="0.35" />
        <rect x="460" y="344" width="40" height="3" rx="2" fill="#2de1ff" opacity="0.3" />
      </svg>
    ),
  },
  space: {
    label: "科幻 · 深空远航",
    render: (u) => (
      <svg {...VB} style={abs} aria-hidden>
        <defs>
          <radialGradient id={`${u}-neb`} cx="0.7" cy="0.3" r="0.9">
            <stop offset="0" stopColor="#28316b" />
            <stop offset="1" stopColor="#05060f" />
          </radialGradient>
          <linearGradient id={`${u}-pl`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#7ea6ff" />
            <stop offset="1" stopColor="#3a2f78" />
          </linearGradient>
        </defs>
        <rect width="640" height="360" fill={`url(#${u}-neb)`} />
        {STARS.map((s, i) => (
          <circle
            key={i}
            cx={s * 640}
            cy={STARS[(i + 11) % STARS.length] * 360}
            r={s > 0.92 ? 1.8 : 1}
            fill="#e8efff"
            opacity={0.3 + (i % 6) * 0.11}
          />
        ))}
        <circle cx="470" cy="250" r="72" fill={`url(#${u}-pl)`} />
        <ellipse cx="470" cy="250" rx="118" ry="26" fill="none" stroke="#9fb4ff" strokeWidth="7" opacity="0.5" transform="rotate(-18 470 250)" />
        <circle cx="440" cy="228" r="12" fill="#ffffff" opacity="0.12" />
        <g transform="rotate(-14 170 130)">
          <path d="M150 130 L196 118 L204 130 L196 142 Z" fill="#dfe8ff" />
          <path d="M150 130 L126 122 L134 130 L126 138 Z" fill="#8fa8d8" />
          <path d="M118 128 L96 130 L118 133 Z" fill="#5ad0ff" opacity="0.85" />
        </g>
      </svg>
    ),
  },
  mystery: {
    label: "悬疑 · 迷雾小巷",
    render: (u) => (
      <svg {...VB} style={abs} aria-hidden>
        <defs>
          <linearGradient id={`${u}-fog`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#151a1c" />
            <stop offset="1" stopColor="#26302f" />
          </linearGradient>
        </defs>
        <rect width="640" height="360" fill={`url(#${u}-fog)`} />
        <polygon points="0,0 200,40 200,360 0,360" fill="#0d1112" />
        <polygon points="640,0 460,40 460,360 640,360" fill="#0d1112" />
        <rect x="70" y="100" width="34" height="48" fill="#1c2426" />
        <rect x="510" y="120" width="34" height="48" fill="#1c2426" />
        <rect x="316" y="70" width="6" height="140" fill="#0a0d0e" />
        <path d="M319 66 l30 12 l-6 8 l-24 -8 Z" fill="#0a0d0e" />
        <circle cx="352" cy="86" r="9" fill="#ffe9a8" />
        <path d="M352 86 L316 300 L392 300 Z" fill="#ffe9a8" opacity="0.12" />
        <ellipse cx="352" cy="302" rx="46" ry="8" fill="#ffe9a8" opacity="0.1" />
        <path d="M340 302 q4 -44 12 -58 q6 -10 4 -22 a8 8 0 1 1 6 0 q4 14 -2 24 q10 18 12 56 Z" fill="#05070a" />
        <rect x="0" y="200" width="640" height="18" fill="#c8d4cf" opacity="0.05" />
        <rect x="0" y="248" width="640" height="26" fill="#c8d4cf" opacity="0.07" />
        <rect x="0" y="308" width="640" height="30" fill="#c8d4cf" opacity="0.08" />
      </svg>
    ),
  },
  kingdom: {
    label: "史诗 · 王国纪元",
    render: (u) => (
      <svg {...VB} style={abs} aria-hidden>
        <defs>
          <linearGradient id={`${u}-dawn`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#3c2c63" />
            <stop offset="0.55" stopColor="#c96f4e" />
            <stop offset="1" stopColor="#f0b661" />
          </linearGradient>
        </defs>
        <rect width="640" height="360" fill={`url(#${u}-dawn)`} />
        <circle cx="320" cy="252" r="52" fill="#ffe1a0" opacity="0.9" />
        <path d="M0 320 L200 260 L420 300 L640 268 L640 360 L0 360 Z" fill="#2c1f3e" />
        <g fill="#1d142b">
          <rect x="252" y="160" width="136" height="120" />
          <rect x="238" y="140" width="30" height="140" />
          <rect x="372" y="140" width="30" height="140" />
          <rect x="300" y="110" width="40" height="170" />
          <polygon points="238,140 253,112 268,140" />
          <polygon points="372,140 387,112 402,140" />
          <polygon points="300,110 320,78 340,110" />
          <rect x="310" y="230" width="20" height="50" rx="9" fill="#0f0a18" />
        </g>
        <path d="M320 78 L320 58 L346 66 L320 74 Z" fill="#d9403f" />
        <path d="M120 120 q10 -8 20 0 q-10 2 -20 0 Z M160 132 q8 -6 16 0 q-8 2 -16 0 Z" fill="#2c1f3e" opacity="0.8" />
      </svg>
    ),
  },
  apocalypse: {
    label: "末日 · 废土余晖",
    render: (u) => (
      <svg {...VB} style={abs} aria-hidden>
        <defs>
          <linearGradient id={`${u}-ash`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#33343a" />
            <stop offset="0.7" stopColor="#6c5648" />
            <stop offset="1" stopColor="#c77b3d" />
          </linearGradient>
        </defs>
        <rect width="640" height="360" fill={`url(#${u}-ash)`} />
        <circle cx="320" cy="286" r="40" fill="#ffce8a" opacity="0.85" />
        <g fill="#26242a">
          <polygon points="40,360 40,180 70,180 74,150 96,150 96,360" />
          <polygon points="130,360 130,120 176,110 176,200 158,204 158,360" />
          <polygon points="470,360 470,140 520,150 516,230 540,236 540,360" />
          <polygon points="574,360 574,190 612,180 612,360" />
          <polygon points="216,360 216,240 268,232 268,360" />
        </g>
        <path d="M0 320 L640 312 L640 360 L0 360 Z" fill="#191619" />
        <path d="M300 330 L340 326 L336 318 L360 322" stroke="#0d0b0d" strokeWidth="5" fill="none" />
        <path d="M420 96 q8 -6 16 0 q-8 2 -16 0 Z M452 110 q6 -5 12 0 q-6 2 -12 0 Z" fill="#1c1a1e" />
        <rect x="90" y="60" width="120" height="4" fill="#8b8b90" opacity="0.25" transform="rotate(8 150 62)" />
      </svg>
    ),
  },
  campus: {
    label: "青春 · 盛夏校园",
    render: (u) => (
      <svg {...VB} style={abs} aria-hidden>
        <defs>
          <linearGradient id={`${u}-sum`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#6cb9f5" />
            <stop offset="1" stopColor="#dff2ff" />
          </linearGradient>
        </defs>
        <rect width="640" height="360" fill={`url(#${u}-sum)`} />
        <ellipse cx="150" cy="90" rx="70" ry="24" fill="#ffffff" opacity="0.9" />
        <ellipse cx="210" cy="104" rx="50" ry="18" fill="#ffffff" opacity="0.8" />
        <ellipse cx="470" cy="60" rx="60" ry="20" fill="#ffffff" opacity="0.85" />
        <path d="M110 250 q140 -70 420 -40" stroke="#5a8fc4" strokeWidth="2.5" strokeDasharray="7 8" fill="none" opacity="0.8" />
        <g transform="rotate(-16 520 200)">
          <polygon points="520,200 566,186 532,214" fill="#ffffff" />
          <polygon points="520,200 552,204 532,214" fill="#d5e8f7" />
        </g>
        <rect x="0" y="284" width="640" height="76" fill="#79c37e" />
        <path d="M0 284 L640 292 L640 300 L0 292 Z" fill="#5aa763" />
        <rect x="60" y="180" width="150" height="104" fill="#f6f2e8" />
        <polygon points="50,180 135,140 220,180" fill="#c96a56" />
        <rect x="122" y="236" width="28" height="48" fill="#7a5a48" />
        <rect x="76" y="200" width="30" height="26" fill="#a9d5f0" />
        <rect x="164" y="200" width="30" height="26" fill="#a9d5f0" />
        <circle cx="135" cy="166" r="9" fill="#fff" />
        <path d="M600 250 q-20 -60 -60 -76 q46 4 66 40 Z" fill="#5aa763" opacity="0.9" />
      </svg>
    ),
  },
  business: {
    label: "商战 · 资本浪潮",
    render: (u) => (
      <svg {...VB} style={abs} aria-hidden>
        <defs>
          <linearGradient id={`${u}-bg`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#07130e" />
            <stop offset="1" stopColor="#0f2c1d" />
          </linearGradient>
        </defs>
        <rect width="640" height="360" fill={`url(#${u}-bg)`} />
        {[0, 1, 2, 3, 4].map((i) => (
          <line key={i} x1="0" y1={80 + i * 56} x2="640" y2={80 + i * 56} stroke="#2f5c40" strokeWidth="1" opacity="0.4" />
        ))}
        {[
          [80, 250, 60, "#2e8b57"],
          [170, 220, 76, "#2e8b57"],
          [260, 236, 44, "#a33c3c"],
          [350, 190, 96, "#2e8b57"],
          [440, 206, 60, "#a33c3c"],
          [530, 140, 140, "#e0b23c"],
        ].map(([x, y, h, f], i) => (
          <g key={i}>
            <rect x={x as number} y={y as number} width="34" height={h as number} fill={f as string} rx="3" />
            <line x1={(x as number) + 17} y1={(y as number) - 22} x2={(x as number) + 17} y2={(y as number) + (h as number) + 16} stroke={f as string} strokeWidth="3" />
          </g>
        ))}
        <path d="M60 268 L200 232 L330 244 L470 180 L590 120" stroke="#ffd98a" strokeWidth="3.5" fill="none" opacity="0.9" />
        <circle cx="590" cy="120" r="6" fill="#ffd98a" />
        <g fill="#e0b23c" opacity="0.9">
          <ellipse cx="96" cy="322" rx="26" ry="8" />
          <ellipse cx="96" cy="312" rx="26" ry="8" />
          <ellipse cx="96" cy="302" rx="26" ry="8" fill="#f2cb66" />
        </g>
      </svg>
    ),
  },
  dungeon: {
    label: "冒险 · 地下城",
    render: (u) => (
      <svg {...VB} style={abs} aria-hidden>
        <rect width="640" height="360" fill="#0b0908" />
        <rect x="180" y="60" width="280" height="300" fill="#141110" />
        <path d="M200 360 L200 130 a120 96 0 0 1 240 0 L440 360 Z" fill="#060504" />
        <path d="M200 130 a120 96 0 0 1 240 0" stroke="#2a231f" strokeWidth="16" fill="none" />
        {[0, 1, 2, 3].map((i) => (
          <rect key={i} x={236 + i * 46} y={330 - i * 0} width="168" height="12" fill={i % 2 ? "#131010" : "#0d0b0a"} transform={`translate(${-i * 23} ${-i * 26})`} />
        ))}
        <g>
          <rect x="150" y="150" width="10" height="60" fill="#3a2c22" />
          <path d="M155 132 q-14 22 0 34 q14 -12 0 -34 Z" fill="#ff9d3c" />
          <path d="M155 140 q-7 12 0 20 q7 -8 0 -20 Z" fill="#ffd98a" />
          <circle cx="155" cy="148" r="26" fill="#ff9d3c" opacity="0.12" />
        </g>
        <g>
          <rect x="480" y="150" width="10" height="60" fill="#3a2c22" />
          <path d="M485 132 q-14 22 0 34 q14 -12 0 -34 Z" fill="#ff9d3c" />
          <path d="M485 140 q-7 12 0 20 q7 -8 0 -20 Z" fill="#ffd98a" />
          <circle cx="485" cy="148" r="26" fill="#ff9d3c" opacity="0.12" />
        </g>
        <path d="M292 208 l14 -34 l14 34 l-14 8 Z" fill="#cfd6e4" opacity="0.9" transform="rotate(18 306 190)" />
        <rect x="316" y="214" width="8" height="22" fill="#6b4a2f" transform="rotate(18 320 225)" />
      </svg>
    ),
  },
  ocean: {
    label: "航海 · 碧海孤帆",
    render: (u) => (
      <svg {...VB} style={abs} aria-hidden>
        <defs>
          <linearGradient id={`${u}-sea`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#8fd8f2" />
            <stop offset="0.55" stopColor="#3fa9d4" />
            <stop offset="1" stopColor="#155f8c" />
          </linearGradient>
        </defs>
        <rect width="640" height="360" fill={`url(#${u}-sea)`} />
        <circle cx="520" cy="80" r="36" fill="#fff4cf" opacity="0.95" />
        <path d="M0 200 Q80 188 160 200 T320 200 T480 200 T640 200 L640 360 L0 360 Z" fill="#2b8ab8" />
        <path d="M0 250 Q90 236 180 250 T360 250 T540 250 T640 246 L640 360 L0 360 Z" fill="#1e6f9c" />
        <path d="M0 306 Q110 292 220 306 T440 306 T640 300 L640 360 L0 360 Z" fill="#155a83" />
        <g>
          <path d="M250 218 L330 218 L314 244 L266 244 Z" fill="#5c4632" />
          <rect x="288" y="130" width="6" height="88" fill="#3f3122" />
          <path d="M294 134 L352 200 L294 200 Z" fill="#fdf6e3" />
          <path d="M286 144 L246 200 L286 200 Z" fill="#e8dcc0" />
          <path d="M294 130 L318 138 L294 146 Z" fill="#d9403f" />
        </g>
        <path d="M120 110 q9 -8 18 0 M146 122 q7 -6 14 0" stroke="#ffffff" strokeWidth="3" fill="none" strokeLinecap="round" opacity="0.9" />
        <path d="M420 300 q20 -8 40 0 M470 316 q16 -6 32 0" stroke="#bde6f5" strokeWidth="3" fill="none" strokeLinecap="round" opacity="0.5" />
      </svg>
    ),
  },
  valorant: {
    label: "旗舰 · 战术电竞",
    render: (u) => (
      <svg {...VB} style={abs} aria-hidden>
        <defs>
          <linearGradient id={`${u}-bg`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#0f1923" />
            <stop offset="1" stopColor="#1a2733" />
          </linearGradient>
        </defs>
        <rect width="640" height="360" fill={`url(#${u}-bg)`} />
        <polygon points="0,0 210,0 90,360 0,360" fill="#ff4655" opacity="0.9" />
        <polygon points="130,0 250,0 130,360 96,360" fill="#ff4655" opacity="0.35" />
        <polygon points="640,360 640,180 520,360" fill="#ff4655" opacity="0.5" />
        <polygon points="640,0 560,0 640,110" fill="#ece8e1" opacity="0.08" />
        <g transform="translate(400 120)">
          <polygon points="0,64 44,0 88,64 66,64 44,32 22,64" fill="#ece8e1" opacity="0.95" />
          <polygon points="22,84 44,52 66,84" fill="#ff4655" opacity="0.95" />
        </g>
        <g stroke="#ece8e1" strokeWidth="3" opacity="0.7" fill="none">
          <path d="M300 60 h-40 v40" />
          <path d="M600 240 v40 h-40" />
        </g>
        <path d="M280 210 h180 M280 226 h140 M280 242 h100" stroke="#3d4d5c" strokeWidth="6" opacity="0.8" />
        <circle cx="560" cy="70" r="3.4" fill="#ff4655" />
        <circle cx="560" cy="70" r="10" fill="none" stroke="#ff4655" strokeWidth="2" opacity="0.5" />
        <circle cx="560" cy="70" r="18" fill="none" stroke="#ff4655" strokeWidth="1.4" opacity="0.25" />
      </svg>
    ),
  },
};

/** 素材库展示顺序（编辑器封面页签用） */
export const COVER_PRESET_LIST: { id: string; label: string }[] = Object.entries(COVER_PRESETS).map(
  ([id, p]) => ({ id, label: p.label })
);

/** 官方游戏与旗舰位的专属封面映射（无需改模板即可生效；meta.coverPreset 优先） */
export const OFFICIAL_PRESET_BY_GAME: Record<string, string> = {
  xiuxian: "xianxia",
  "yeye-bus": "night-bus",
  "esports-lite": "esports",
  "val-manager": "valorant",
};

export default function GameCover({
  id,
  title,
  kind,
  wide,
  preset,
  coverUrl,
}: {
  id: string;
  title: string;
  kind: string;
  wide?: boolean;
  /** 素材库预设 id（meta.coverPreset） */
  preset?: string;
  /** 自定义封面图 URL（/api/games/:id/cover?v=…），优先级最高 */
  coverUrl?: string | null;
}): React.ReactElement {
  const chosen = (preset && COVER_PRESETS[preset] ? preset : undefined) ?? OFFICIAL_PRESET_BY_GAME[id];
  const presetDef = chosen ? COVER_PRESETS[chosen] : undefined;
  const [a, b] = PALETTES[hashOf(id) % PALETTES.length];
  const uid = `cv-${hashOf(id + (chosen ?? "")).toString(36)}`;
  return (
    <div
      className={`cover ${wide ? "cover-wide" : ""}`}
      style={presetDef || coverUrl ? { background: "#10141c" } : { background: `linear-gradient(135deg, ${a} 0%, ${b} 100%)` }}
    >
      {coverUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={coverUrl} alt="" style={{ ...abs, width: "100%", height: "100%", objectFit: "cover" }} />
      ) : presetDef ? (
        presetDef.render(uid)
      ) : (
        <span className="cover-icon" aria-hidden>
          {KIND_ICON[kind] ?? KIND_ICON.unknown}
        </span>
      )}
      {(coverUrl || presetDef) && <span className="cover-scrim" aria-hidden />}
      <span className="cover-title">{title}</span>
    </div>
  );
}
