/**
 * 站点标志：一个对话气泡，里面是两行文字和一个正在输入的光标——
 * 「跟 AI 聊着聊着，就聊出一个文字游戏」。
 * 纯几何路径，不依赖任何字体，缩到 16px 当 favicon 也认得出。
 */
export default function BrandMark({ size = 28 }: { size?: number }): React.ReactElement {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden focusable="false">
      <defs>
        <linearGradient id="wgp-mark" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#58b2f0" />
          <stop offset="1" stopColor="#7a5cc9" />
        </linearGradient>
      </defs>
      {/* 气泡 */}
      <path
        d="M6 4h20a4 4 0 0 1 4 4v13a4 4 0 0 1-4 4H14l-7 5v-5H6a4 4 0 0 1-4-4V8a4 4 0 0 1 4-4Z"
        fill="url(#wgp-mark)"
      />
      {/* 气泡里的两行文字 */}
      <rect x="7" y="11" width="13" height="2.6" rx="1.3" fill="#0d1117" opacity="0.78" />
      <rect x="7" y="16.4" width="8.5" height="2.6" rx="1.3" fill="#0d1117" opacity="0.78" />
      {/* 正在输入的光标 */}
      <rect x="18.4" y="15.2" width="2.8" height="5" rx="1.2" fill="#66c04b" />
    </svg>
  );
}
