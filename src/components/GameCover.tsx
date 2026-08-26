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
const WHEAT = seq(77, 72);
const SNOW = seq(91, 70);
const CROWD = seq(105, 40);

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
  snowlodge: {
    label: "推理 · 雪夜山庄",
    render: (u) => (
      <svg {...VB} style={abs} aria-hidden>
        <defs>
          <linearGradient id={`${u}-night`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#0a1228" />
            <stop offset="1" stopColor="#1b2a4a" />
          </linearGradient>
        </defs>
        <rect width="640" height="360" fill={`url(#${u}-night)`} />
        <circle cx="540" cy="70" r="34" fill="#e8ecf5" opacity="0.9" />
        <path d="M0 330 Q160 300 320 322 T640 316 L640 360 L0 360 Z" fill="#dfe7f2" />
        <path d="M40 330 L90 240 L140 330 Z M120 335 L180 220 L240 335 Z" fill="#101b33" />
        <path d="M96 262 h-12 M108 244 h-14" stroke="#dfe7f2" strokeWidth="3" opacity="0.5" />
        <g>
          <rect x="380" y="220" width="170" height="96" fill="#1d283f" />
          <polygon points="365,220 465,168 565,220" fill="#e8ecf5" />
          <rect x="398" y="244" width="34" height="30" fill="#ffd98a" />
          <rect x="452" y="244" width="34" height="30" fill="#ffd98a" opacity="0.85" />
          <rect x="506" y="244" width="30" height="30" fill="#2a3a5c" />
          <rect x="414" y="286" width="26" height="30" fill="#0d1526" />
          <rect x="478" y="172" width="14" height="34" fill="#1d283f" />
          <path d="M485 168 q10 -12 4 -22" stroke="#c9d4e6" strokeWidth="4" fill="none" opacity="0.6" strokeLinecap="round" />
        </g>
        <path d="M470 318 q40 6 90 2" stroke="#8fa4c4" strokeWidth="3" opacity="0.5" fill="none" />
        {STARS.slice(0, 60).map((s, i) => (
          <circle
            key={i}
            cx={s * 640}
            cy={STARS[(i + 17) % STARS.length] * 300}
            r={1.4 + (i % 3) * 0.5}
            fill="#ffffff"
            opacity={0.35 + (i % 4) * 0.12}
          />
        ))}
        <rect x="398" y="248" width="34" height="4" fill="#3a2c22" opacity="0.6" />
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
  // ---- 下面这批是按「卡通 / 风景 / 人物 / 徽标」四类扩充的，全部原创手绘 SVG。
  // 不从网上抓图：来路不明的图有版权风险，位图也会把页面撑肥；SVG 零外部依赖、任意分辨率都清晰。
  "cat-time": {
    label: "卡通 · 猫咪时光",
    render: (u) => (
      <svg {...VB} style={abs} aria-hidden>
        <defs>
          <linearGradient id={`${u}-bg`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#ffe3c2" />
            <stop offset="1" stopColor="#ffd0b8" />
          </linearGradient>
        </defs>
        <rect width="640" height="360" fill={`url(#${u}-bg)`} />
        <circle cx="540" cy="70" r="34" fill="#ffb85c" opacity="0.7" />
        <g>
          <polygon points="180,120 210,58 246,116" fill="#f2ede4" />
          <polygon points="330,116 362,58 392,120" fill="#f2ede4" />
          <polygon points="192,112 212,72 236,110" fill="#ffb0a0" />
          <polygon points="338,110 360,72 380,112" fill="#ffb0a0" />
          <ellipse cx="286" cy="200" rx="130" ry="112" fill="#f2ede4" />
          <path d="M156 200 a130 112 0 0 1 60 -94 l40 60 Z" fill="#e8b46a" />
          <path d="M416 196 a130 112 0 0 0 -54 -92 l-38 58 Z" fill="#e8b46a" />
          <path d="M236 196 q12 12 24 0" stroke="#4a3b30" strokeWidth="5" fill="none" strokeLinecap="round" />
          <path d="M322 196 q12 12 24 0" stroke="#4a3b30" strokeWidth="5" fill="none" strokeLinecap="round" />
          <path d="M278 226 q8 10 16 0 M286 226 l0 -10" stroke="#4a3b30" strokeWidth="4" fill="none" strokeLinecap="round" />
          <ellipse cx="286" cy="218" rx="8" ry="6" fill="#ff8f7a" />
          <circle cx="222" cy="228" r="12" fill="#ffb0a0" opacity="0.55" />
          <circle cx="350" cy="228" r="12" fill="#ffb0a0" opacity="0.55" />
          <path d="M180 214 L120 204 M182 228 L124 232 M186 242 L132 256" stroke="#4a3b30" strokeWidth="2.4" opacity="0.7" />
          <path d="M392 214 L452 204 M390 228 L448 232 M386 242 L440 256" stroke="#4a3b30" strokeWidth="2.4" opacity="0.7" />
        </g>
        <g>
          <circle cx="512" cy="270" r="40" fill="#ff8f7a" />
          <path d="M478 258 q34 -22 68 8 M482 288 q30 -26 62 -4 M500 236 q-6 34 10 68" stroke="#e56a58" strokeWidth="4" fill="none" opacity="0.8" />
          <path d="M548 288 q30 10 44 -6" stroke="#e56a58" strokeWidth="5" fill="none" strokeLinecap="round" />
        </g>
        <g fill="#e8a087" opacity="0.8">
          <circle cx="96" cy="316" r="7" />
          <circle cx="112" cy="300" r="5" />
          <circle cx="128" cy="318" r="5" />
          <circle cx="112" cy="330" r="4" />
          <circle cx="180" cy="320" r="7" />
          <circle cx="196" cy="304" r="5" />
          <circle cx="212" cy="322" r="5" />
        </g>
      </svg>
    ),
  },
  "cloud-town": {
    label: "卡通 · 云上小镇",
    render: (u) => (
      <svg {...VB} style={abs} aria-hidden>
        <defs>
          <linearGradient id={`${u}-sky`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#7fc4f5" />
            <stop offset="1" stopColor="#ffd9e8" />
          </linearGradient>
        </defs>
        <rect width="640" height="360" fill={`url(#${u}-sky)`} />
        <path d="M40 150 a90 90 0 0 1 180 0" stroke="#ff9db0" strokeWidth="10" fill="none" opacity="0.75" />
        <path d="M52 150 a78 78 0 0 1 156 0" stroke="#ffd98a" strokeWidth="10" fill="none" opacity="0.75" />
        <path d="M64 150 a66 66 0 0 1 132 0" stroke="#8fe0c0" strokeWidth="10" fill="none" opacity="0.75" />
        <g>
          <ellipse cx="320" cy="280" rx="230" ry="54" fill="#ffffff" />
          <ellipse cx="170" cy="262" rx="80" ry="36" fill="#ffffff" />
          <ellipse cx="470" cy="262" rx="90" ry="38" fill="#ffffff" />
          <ellipse cx="320" cy="250" rx="120" ry="40" fill="#f4f9ff" />
        </g>
        <g>
          <rect x="240" y="190" width="64" height="60" rx="6" fill="#ffd98a" />
          <polygon points="232,192 272,160 312,192" fill="#e5766a" />
          <rect x="262" y="218" width="20" height="32" rx="3" fill="#8a5c3a" />
          <rect x="330" y="200" width="52" height="50" rx="6" fill="#a5d8ff" />
          <polygon points="324,202 356,176 388,202" fill="#5a8fc4" />
          <rect x="344" y="216" width="18" height="16" rx="2" fill="#fff6cf" />
          <rect x="410" y="212" width="44" height="40" rx="5" fill="#ffb0a0" />
          <polygon points="404,214 432,192 460,214" fill="#c96a56" />
        </g>
        <g>
          <path d="M540 170 a34 42 0 1 1 0.1 0" fill="#ff7d9c" />
          <path d="M540 170 a34 42 0 1 1 0.1 0" fill="#ffffff" opacity="0.2" transform="translate(-8 -4)" />
          <path d="M528 208 L540 236 L552 208" fill="none" stroke="#8a5c3a" strokeWidth="3" />
          <rect x="531" y="234" width="18" height="14" rx="3" fill="#8a5c3a" />
        </g>
        <ellipse cx="90" cy="70" rx="44" ry="16" fill="#ffffff" opacity="0.9" />
        <ellipse cx="580" cy="60" rx="38" ry="14" fill="#ffffff" opacity="0.85" />
        {PETALS.slice(0, 18).map((p, i) => (
          <circle key={i} cx={p * 640} cy={PETALS[(i + 9) % PETALS.length] * 140} r={2 + (i % 3)} fill="#ffffff" opacity="0.6" />
        ))}
      </svg>
    ),
  },
  "pixel-quest": {
    label: "卡通 · 8比特冒险",
    render: (u) => (
      <svg {...VB} style={abs} aria-hidden>
        <rect width="640" height="360" fill="#1a1c3a" />
        <g fill="#ffd98a">
          <rect x="500" y="48" width="16" height="16" />
          <rect x="484" y="64" width="16" height="16" />
          <rect x="500" y="64" width="16" height="16" />
          <rect x="516" y="64" width="16" height="16" />
          <rect x="500" y="80" width="16" height="16" />
        </g>
        {[
          [0, 260, "#2e8b57"], [48, 236, "#2e8b57"], [96, 212, "#2e8b57"], [144, 188, "#37a06a"],
          [192, 212, "#2e8b57"], [240, 236, "#2e8b57"], [288, 212, "#37a06a"], [336, 188, "#2e8b57"],
          [384, 164, "#37a06a"], [432, 188, "#2e8b57"], [480, 212, "#2e8b57"], [528, 236, "#37a06a"], [576, 260, "#2e8b57"],
        ].map(([x, y, f], i) => (
          <g key={i} fill={f as string}>
            <rect x={x as number} y={y as number} width="48" height={300 - (y as number)} />
            <rect x={(x as number) + 8} y={(y as number) - 12} width="32" height="12" opacity="0.85" />
          </g>
        ))}
        <rect x="0" y="300" width="640" height="60" fill="#5d4023" />
        <rect x="0" y="300" width="640" height="14" fill="#7a5a30" />
        {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
          <rect key={i} x={i * 84} y={314} width="10" height="10" fill="#4a3218" />
        ))}
        <g>
          <rect x="292" y="212" width="40" height="40" fill="#f2ede4" />
          <rect x="300" y="222" width="8" height="8" fill="#1a1c3a" />
          <rect x="318" y="222" width="8" height="8" fill="#1a1c3a" />
          <rect x="300" y="240" width="26" height="6" fill="#e5766a" />
          <rect x="284" y="252" width="56" height="30" fill="#3a6df0" />
          <rect x="284" y="252" width="12" height="20" fill="#f2ede4" />
          <rect x="328" y="252" width="12" height="20" fill="#f2ede4" />
          <rect x="340" y="230" width="8" height="34" fill="#c9d4e6" />
          <rect x="336" y="226" width="16" height="8" fill="#8a5c3a" />
        </g>
        <g fill="#ffd98a">
          <rect x="120" y="120" width="8" height="8" />
          <rect x="220" y="80" width="8" height="8" />
          <rect x="420" y="100" width="8" height="8" />
          <rect x="600" y="140" width="8" height="8" />
          <rect x="60" y="60" width="8" height="8" />
        </g>
      </svg>
    ),
  },
  "wheat-field": {
    label: "风景 · 麦浪金秋",
    render: (u) => (
      <svg {...VB} style={abs} aria-hidden>
        <defs>
          <linearGradient id={`${u}-sky`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#ffdf9e" />
            <stop offset="1" stopColor="#fff4d6" />
          </linearGradient>
        </defs>
        <rect width="640" height="360" fill={`url(#${u}-sky)`} />
        <circle cx="150" cy="90" r="40" fill="#ff9d3c" opacity="0.9" />
        <path d="M0 220 Q160 200 320 216 T640 210 L640 360 L0 360 Z" fill="#e8b13c" />
        <path d="M0 262 Q180 242 360 258 T640 252 L640 360 L0 360 Z" fill="#d99a2b" />
        <path d="M0 306 Q200 288 420 302 T640 298 L640 360 L0 360 Z" fill="#b57b1d" />
        <g>
          <rect x="470" y="120" width="12" height="110" fill="#6d4a24" />
          <polygon points="446,232 508,232 496,214 458,214" fill="#8a5c3a" />
          <g stroke="#4a3218" strokeWidth="7" strokeLinecap="round">
            <path d="M476 128 L432 92" />
            <path d="M476 128 L520 96" />
            <path d="M476 128 L438 168" />
            <path d="M476 128 L516 166" />
          </g>
          <circle cx="476" cy="128" r="8" fill="#e8b13c" />
        </g>
        {WHEAT.slice(0, 36).map((w, i) => (
          <path
            key={i}
            d={`M${w * 640} 360 q${(i % 2 ? 6 : -6)} -26 ${(i % 2 ? 4 : -4)} -48`}
            stroke={i % 3 ? "#f4c95d" : "#e8b13c"}
            strokeWidth="3.4"
            fill="none"
            strokeLinecap="round"
            opacity={0.5 + (i % 4) * 0.12}
          />
        ))}
        <path d="M240 70 q9 -8 18 0 M270 84 q7 -6 14 0 M300 70 q7 -6 14 0" stroke="#8a6a3a" strokeWidth="3" fill="none" strokeLinecap="round" opacity="0.8" />
      </svg>
    ),
  },
  "cloud-falls": {
    label: "风景 · 云谷飞瀑",
    render: (u) => (
      <svg {...VB} style={abs} aria-hidden>
        <defs>
          <linearGradient id={`${u}-sky`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#bfe6da" />
            <stop offset="1" stopColor="#e8f4ec" />
          </linearGradient>
        </defs>
        <rect width="640" height="360" fill={`url(#${u}-sky)`} />
        <path d="M0 120 L140 40 L280 150 L280 360 L0 360 Z" fill="#3d7a68" />
        <path d="M280 150 L420 60 L640 170 L640 360 L280 360 Z" fill="#2c5d50" />
        <path d="M0 210 L120 150 L260 226 L260 360 L0 360 Z" fill="#24493f" />
        <g>
          <rect x="330" y="120" width="46" height="160" fill="#f4fbf7" opacity="0.95" />
          <path d="M336 130 v140 M348 124 v150 M362 132 v138" stroke="#cfe8e3" strokeWidth="4" opacity="0.8" />
          <ellipse cx="353" cy="290" rx="70" ry="18" fill="#ffffff" opacity="0.85" />
          <ellipse cx="353" cy="302" rx="110" ry="20" fill="#ffffff" opacity="0.5" />
        </g>
        <path d="M0 320 Q160 300 340 318 T640 312 L640 360 L0 360 Z" fill="#17332c" />
        <g fill="#17332c">
          <polygon points="80,270 96,232 112,270" />
          <polygon points="110,282 128,238 146,282" />
          <polygon points="530,270 548,228 566,270" />
          <polygon points="566,282 582,244 598,282" />
        </g>
        <ellipse cx="150" cy="128" rx="60" ry="16" fill="#ffffff" opacity="0.75" />
        <ellipse cx="480" cy="96" rx="70" ry="18" fill="#ffffff" opacity="0.7" />
        <ellipse cx="300" cy="180" rx="50" ry="12" fill="#ffffff" opacity="0.5" />
      </svg>
    ),
  },
  "desert-bell": {
    label: "风景 · 大漠驼铃",
    render: (u) => (
      <svg {...VB} style={abs} aria-hidden>
        <defs>
          <linearGradient id={`${u}-dusk`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#5a2a5c" />
            <stop offset="0.5" stopColor="#c9552e" />
            <stop offset="1" stopColor="#f0a44a" />
          </linearGradient>
        </defs>
        <rect width="640" height="360" fill={`url(#${u}-dusk)`} />
        <circle cx="440" cy="170" r="52" fill="#ffd98a" opacity="0.95" />
        <path d="M0 250 Q180 190 400 246 T640 236 L640 360 L0 360 Z" fill="#a3552a" />
        <path d="M0 300 Q220 250 460 296 T640 286 L640 360 L0 360 Z" fill="#7a3a1e" />
        <path d="M240 258 q60 -18 160 -6" stroke="#5d2a14" strokeWidth="3" fill="none" opacity="0.5" />
        <g fill="#2c1410">
          <path d="M300 262 q6 -20 22 -22 q4 -12 16 -10 q10 -14 24 -6 q14 -4 18 10 q14 4 12 20 l-8 26 l-8 -2 l4 -20 q-30 -8 -60 0 l4 22 l-8 2 Z" />
          <rect x="304" y="278" width="5" height="26" />
          <rect x="322" y="282" width="5" height="24" />
          <rect x="352" y="282" width="5" height="24" />
          <rect x="370" y="278" width="5" height="26" />
          <path d="M376 236 q10 -8 12 -22 l6 2 q0 14 -10 24 Z" />
        </g>
        <circle cx="382" cy="252" r="4" fill="#ffd98a" />
        {STARS.slice(0, 26).map((s, i) => (
          <circle key={i} cx={s * 640} cy={STARS[(i + 13) % STARS.length] * 120} r={1.2 + (i % 2)} fill="#ffe9c9" opacity={0.4 + (i % 3) * 0.2} />
        ))}
      </svg>
    ),
  },
  "aurora-night": {
    label: "风景 · 冰原极光",
    render: (u) => (
      <svg {...VB} style={abs} aria-hidden>
        <defs>
          <linearGradient id={`${u}-night`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#04081c" />
            <stop offset="1" stopColor="#0d1f3c" />
          </linearGradient>
          <linearGradient id={`${u}-aur`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#4ef0b8" stopOpacity="0" />
            <stop offset="0.5" stopColor="#4ef0b8" stopOpacity="0.65" />
            <stop offset="1" stopColor="#8f6bff" stopOpacity="0.2" />
          </linearGradient>
        </defs>
        <rect width="640" height="360" fill={`url(#${u}-night)`} />
        <path d="M60 20 q30 120 -10 200 l60 6 q44 -110 16 -206 Z" fill={`url(#${u}-aur)`} />
        <path d="M200 0 q40 130 -6 230 l70 8 q50 -120 12 -238 Z" fill={`url(#${u}-aur)`} opacity="0.9" />
        <path d="M380 10 q36 110 -8 210 l64 6 q48 -110 14 -216 Z" fill={`url(#${u}-aur)`} opacity="0.7" />
        <path d="M530 30 q26 90 -8 170 l52 6 q38 -90 12 -176 Z" fill={`url(#${u}-aur)`} opacity="0.55" />
        {STARS.slice(0, 50).map((s, i) => (
          <circle key={i} cx={s * 640} cy={STARS[(i + 7) % STARS.length] * 240} r={s > 0.9 ? 1.8 : 1} fill="#e8efff" opacity={0.3 + (i % 5) * 0.12} />
        ))}
        <path d="M0 300 Q160 280 320 296 T640 292 L640 360 L0 360 Z" fill="#dfe7f2" />
        <path d="M0 322 Q200 306 420 320 T640 316 L640 360 L0 360 Z" fill="#b9c8dd" opacity="0.8" />
        <g fill="#101b33">
          <polygon points="120,300 138,258 156,300" />
          <polygon points="150,306 166,270 182,306" />
        </g>
        {SNOW.slice(0, 30).map((s, i) => (
          <circle key={i} cx={s * 640} cy={SNOW[(i + 11) % SNOW.length] * 300} r={1.6 + (i % 2)} fill="#ffffff" opacity="0.7" />
        ))}
      </svg>
    ),
  },
  "window-tale": {
    label: "人物 · 窗边物语",
    render: (u) => (
      <svg {...VB} style={abs} aria-hidden>
        <defs>
          <linearGradient id={`${u}-room`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#3a2c2a" />
            <stop offset="1" stopColor="#241a19" />
          </linearGradient>
          <linearGradient id={`${u}-win`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#0d1f3c" />
            <stop offset="1" stopColor="#27447a" />
          </linearGradient>
        </defs>
        <rect width="640" height="360" fill={`url(#${u}-room)`} />
        <rect x="200" y="40" width="250" height="230" rx="8" fill="#171010" />
        <rect x="212" y="52" width="226" height="206" fill={`url(#${u}-win)`} />
        <rect x="320" y="52" width="8" height="206" fill="#171010" />
        <rect x="212" y="150" width="226" height="8" fill="#171010" />
        <circle cx="392" cy="102" r="26" fill="#f5efdc" opacity="0.95" />
        {STARS.slice(0, 24).map((s, i) => (
          <circle key={i} cx={216 + s * 216} cy={56 + STARS[(i + 5) % STARS.length] * 90} r="1.3" fill="#e8efff" opacity={0.4 + (i % 3) * 0.2} />
        ))}
        <path d="M212 258 h226" stroke="#4a3b30" strokeWidth="10" />
        <g fill="#0d0908">
          <path d="M260 258 q0 -52 34 -58 q-10 -16 4 -28 a16 16 0 1 1 22 6 q20 4 26 30 q22 10 22 50 Z" />
          <path d="M318 214 q24 -10 44 4 l-6 12 q-18 -10 -36 -4 Z" />
        </g>
        <rect x="366" y="216" width="30" height="22" rx="2" fill="#e8dcc0" transform="rotate(-14 381 227)" />
        <g>
          <rect x="470" y="196" width="70" height="8" fill="#4a3b30" />
          <rect x="498" y="204" width="14" height="60" fill="#3a2c22" />
          <path d="M470 196 q-14 -34 10 -52 q4 24 -2 52 Z M540 196 q14 -34 -10 -52 q-4 24 2 52 Z" fill="#2e8b57" />
        </g>
        <rect x="120" y="40" width="46" height="280" fill="#5d2a20" rx="6" />
        <path d="M120 40 q30 140 0 280" fill="#6d3526" />
        <rect x="0" y="320" width="640" height="40" fill="#171010" />
        <circle cx="586" cy="80" r="24" fill="#ffd98a" opacity="0.14" />
      </svg>
    ),
  },
  "moon-blade": {
    label: "人物 · 月下独行",
    render: (u) => (
      <svg {...VB} style={abs} aria-hidden>
        <defs>
          <linearGradient id={`${u}-night`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#141830" />
            <stop offset="1" stopColor="#2a2350" />
          </linearGradient>
        </defs>
        <rect width="640" height="360" fill={`url(#${u}-night)`} />
        <circle cx="320" cy="170" r="110" fill="#f5efdc" opacity="0.95" />
        <circle cx="286" cy="140" r="14" fill="#e5dcc2" opacity="0.8" />
        <circle cx="352" cy="196" r="9" fill="#e5dcc2" opacity="0.7" />
        <g stroke="#0d0a1c" strokeWidth="7" strokeLinecap="round" opacity="0.9">
          <path d="M70 360 L82 130 M82 200 q30 -10 44 -34 M82 240 q26 6 46 -8" />
          <path d="M580 360 L570 150 M570 210 q-28 -8 -40 -30 M570 250 q-24 6 -42 -6" />
        </g>
        <g fill="#0d0a1c">
          <circle cx="322" cy="196" r="13" />
          <path d="M310 208 q12 -8 24 0 l6 44 q-18 8 -36 0 Z" />
          <path d="M314 250 l-8 60 l12 0 l8 -48 l8 48 l12 0 l-8 -60 Z" />
          <path d="M332 216 L392 186 l4 8 L338 232 Z" />
          <path d="M296 214 q-20 18 -18 42 l8 2 q2 -20 16 -34 Z" />
          <path d="M392 186 l18 -10 l3 5 l-17 13 Z" fill="#8fa8d8" />
        </g>
        <path d="M0 330 Q160 316 320 326 T640 322 L640 360 L0 360 Z" fill="#0d0a1c" />
        <ellipse cx="320" cy="332" rx="150" ry="10" fill="#8fa8d8" opacity="0.12" />
        {STARS.slice(0, 30).map((s, i) => (
          <circle key={i} cx={s * 640} cy={STARS[(i + 19) % STARS.length] * 130} r="1.3" fill="#e8efff" opacity={0.3 + (i % 4) * 0.15} />
        ))}
      </svg>
    ),
  },
  "stage-light": {
    label: "人物 · 舞台之光",
    render: (u) => (
      <svg {...VB} style={abs} aria-hidden>
        <defs>
          <linearGradient id={`${u}-beam`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#ffe9a8" stopOpacity="0.7" />
            <stop offset="1" stopColor="#ffe9a8" stopOpacity="0.05" />
          </linearGradient>
        </defs>
        <rect width="640" height="360" fill="#120a1e" />
        <rect x="0" y="0" width="640" height="26" fill="#080410" />
        <circle cx="160" cy="20" r="10" fill="#2a2138" />
        <circle cx="320" cy="20" r="10" fill="#2a2138" />
        <circle cx="480" cy="20" r="10" fill="#2a2138" />
        <polygon points="150,28 60,250 260,250" fill={`url(#${u}-beam)`} />
        <polygon points="320,28 230,260 410,260" fill={`url(#${u}-beam)`} opacity="0.9" />
        <polygon points="490,28 390,250 590,250" fill={`url(#${u}-beam)`} />
        <g fill="#080410">
          <path d="M148 250 q0 -30 18 -34 q-8 -12 2 -20 a11 11 0 1 1 16 4 q14 6 14 28 l-4 22 Z" />
          <rect x="176" y="196" width="5" height="40" fill="#3a2c50" />
          <path d="M300 244 q0 -34 20 -38 q-8 -12 2 -20 a11 11 0 1 1 16 4 q16 6 16 32 l-4 22 Z" />
          <path d="M338 216 q18 -12 30 -28 l6 6 q-12 18 -30 30 Z" />
          <path d="M472 250 q0 -30 18 -34 q-8 -12 2 -20 a11 11 0 1 1 16 4 q14 6 14 28 l-4 22 Z" />
          <path d="M508 224 l26 -8 l3 8 l-26 10 Z" />
        </g>
        <path d="M368 176 a10 10 0 1 1 0.1 0 M366 186 q2 10 -4 18" stroke="#ffd98a" strokeWidth="3" fill="none" opacity="0.9" />
        <rect x="0" y="250" width="640" height="14" fill="#241a38" />
        <path
          d={`M0 360 L0 300 ${CROWD.map((c, i) => `L${(i + 1) * 16} ${292 + c * 22}`).join(" ")} L640 300 L640 360 Z`}
          fill="#05030c"
        />
        {CONFETTI.slice(0, 24).map((c, i) => (
          <rect key={i} x={c * 640} y={CONFETTI[(i + 5) % CONFETTI.length] * 160 + 30} width="4" height="7" rx="1" fill={["#ff5d8f", "#5ad0ff", "#ffd98a"][i % 3]} opacity="0.75" transform={`rotate(${(c * 80) | 0} ${c * 640} ${CONFETTI[(i + 5) % CONFETTI.length] * 160 + 30})`} />
        ))}
      </svg>
    ),
  },
  "griffin-crest": {
    label: "徽标 · 狮鹫纹章",
    render: (u) => (
      <svg {...VB} style={abs} aria-hidden>
        <defs>
          <linearGradient id={`${u}-bg`} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#1d1330" />
            <stop offset="1" stopColor="#33122a" />
          </linearGradient>
          <linearGradient id={`${u}-gold`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#f2cb66" />
            <stop offset="1" stopColor="#b57b1d" />
          </linearGradient>
        </defs>
        <rect width="640" height="360" fill={`url(#${u}-bg)`} />
        <path d="M320 20 L500 60 L500 190 Q500 290 320 344 Q140 290 140 190 L140 60 Z" fill={`url(#${u}-gold)`} />
        <path d="M320 38 L482 74 L482 188 Q482 276 320 326 Q158 276 158 188 L158 74 Z" fill="#251438" />
        <path d="M320 38 L320 326 Q158 276 158 188 L158 74 Z" fill="#8f2b3c" />
        <g fill="#f2cb66">
          <path d="M290 120 q-30 4 -40 30 q16 -6 26 -2 q-16 12 -14 34 q12 -14 26 -14 q-6 20 8 34 l10 -18 q8 22 26 24 q-4 -14 2 -26 q14 8 30 2 q-12 -8 -14 -22 q16 2 26 -10 q-16 -6 -22 -16 q12 -18 4 -38 q-10 16 -24 20 q-2 -18 -18 -28 q4 14 -4 26 q-10 -2 -22 4 Z" />
          <circle cx="338" cy="128" r="5" fill="#251438" />
        </g>
        <path d="M180 300 q140 54 280 0 l-10 22 q-130 44 -260 0 Z" fill={`url(#${u}-gold)`} />
        <g stroke="#f2cb66" strokeWidth="5" fill="none" opacity="0.9">
          <path d="M120 96 q-24 60 8 128" />
          <path d="M520 96 q24 60 -8 128" />
        </g>
        <g fill="#f2cb66" opacity="0.9">
          <circle cx="118" cy="88" r="6" />
          <circle cx="522" cy="88" r="6" />
          <circle cx="126" cy="234" r="6" />
          <circle cx="514" cy="234" r="6" />
        </g>
      </svg>
    ),
  },
  "geo-mark": {
    label: "徽标 · 极简几何",
    render: (u) => (
      <svg {...VB} style={abs} aria-hidden>
        <rect width="640" height="360" fill="#f4f1ea" />
        {[1, 2, 3, 4, 5].map((i) => (
          <line key={i} x1={i * 106} y1="0" x2={i * 106} y2="360" stroke="#e0dbd0" strokeWidth="1" />
        ))}
        {[1, 2].map((i) => (
          <line key={i} x1="0" y1={i * 120} x2="640" y2={i * 120} stroke="#e0dbd0" strokeWidth="1" />
        ))}
        <circle cx="292" cy="170" r="86" fill="#1e3a8a" />
        <circle cx="292" cy="170" r="86" fill="none" stroke="#10245c" strokeWidth="4" />
        <polygon points="330,96 452,256 208,256" fill="#e5484d" opacity="0.88" />
        <rect x="376" y="120" width="30" height="136" fill="#f0b429" />
        <circle cx="256" cy="150" r="20" fill="#f4f1ea" />
        <rect x="180" y="292" width="130" height="10" rx="5" fill="#1e3a8a" />
        <rect x="324" y="292" width="60" height="10" rx="5" fill="#e5484d" />
        <rect x="398" y="292" width="30" height="10" rx="5" fill="#f0b429" />
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
  romance: "romance",
  "romance-m": "campus",
  "snow-manor": "snowlodge",
  "cold-case": "mystery",
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
