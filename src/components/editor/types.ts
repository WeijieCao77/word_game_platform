// 创作工作台各模块共用的类型：页签名、对话消息、素材清单条目。
// 这些类型被 page.tsx 和 editor/ 下多个模块同时引用，
// 放在这里是为了让子模块不必反过来 import 页面文件。

export type Tab = "preview" | "design" | "config" | "check" | "library" | "cover";

export interface ChatMsg {
  role: "user" | "assistant" | "system";
  content: string;
}

/** 本作品自己的素材（走 /api/games/:id/assets） */
export interface AssetItem {
  name: string;
  contentType: string;
  size: number;
}

/** 公共素材库里的素材（走 /api/library/assets） */
export interface LibAssetItem {
  id: string;
  name: string;
  size: number;
  author: string;
}
