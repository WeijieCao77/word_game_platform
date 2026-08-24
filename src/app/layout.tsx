import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "字游 · 文字游戏创作平台",
  description: "有想法就能做文字游戏：跟 AI 策划聊一聊，生成、试玩、发布，一条链接分享给所有人。",
};

export default function RootLayout({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
