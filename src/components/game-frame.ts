"use client";

import { RefObject, useCallback, useEffect, useRef, useState } from "react";

/**
 * 自由模式作品的「外壳协议」——游戏跑在沙箱 iframe 里，一切都靠 postMessage。
 *
 * 这段逻辑本来只长在玩家页的 CodeGameFrame 里，**编辑器的预览页签一个字都没有**。
 * 那正是老板撞到的那一幕的根子：
 *
 *   - 作者预览里作品抛了异常 → 沙箱里的兜底脚本画出血红横幅、并 postMessage 出来
 *     → **编辑器没人接** → 报错从来没进过 game_errors → AI 调 read_errors 得到
 *     「没有报错记录」→ 它据此认为一切正常，下一轮接着往上盖。
 *     作者看到的是「AI 说做好了，可我这儿一片血红」，来回好几轮谁也说不清。
 *   - 游戏开局问平台要存档（wgp:load）→ **编辑器没人回** → 等存档的作品
 *     就那么一直转圈，作者以为「预览打不开」。
 *
 * 所以把协议抽出来，玩家页和编辑器预览共用同一份：**作者预览到的环境，
 * 跟玩家真正玩到的环境是同一个**。这也是平台的老规矩——两边不一致，
 * 早晚要出「我这儿好好的」这种扯不清的事。
 */

export interface FrameBridgeOptions {
  gameId: string;
  frameRef: RefObject<HTMLIFrameElement | null>;
  /**
   * 存档放在哪个 localStorage 键上。
   * 编辑器预览会传一个不同的键——作者试玩不该把自己正式那局存档冲掉。
   */
  saveKey: string;
  /** 作品抛异常时叫一声（编辑器用它弹「预览报错了，点这里让 AI 修」） */
  onError?: (e: { message: string; stack: string; source: string }) => void;
}

export interface FrameBridge {
  /** 游戏那边喊过 wgp:ready 了没有（或者兜底超时到了） */
  ready: boolean;
  /** 清掉这部作品的存档（「重新开始」用） */
  clearSave: () => void;
  /**
   * 手动宣布「起来了」。
   *
   * iframe 有时候是在挂载之后很久才开始加载的（要先去换预览通行证），
   * 那时候钩子里那个兜底计时器早就过去了。所以 iframe 的 onLoad 还要再补一次，
   * 不然遮罩会永远挂在那儿——作者看到的就是「预览一直在载入」。
   */
  markReady: () => void;
}

export function useGameFrameBridge({ gameId, frameRef, saveKey, onError }: FrameBridgeOptions): FrameBridge {
  const [ready, setReady] = useState(false);
  // onError 每次渲染都是新函数，放进依赖会让监听反复装卸——用 ref 接住
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  const post = useCallback(
    (msg: unknown) => {
      frameRef.current?.contentWindow?.postMessage(msg, "*");
    },
    [frameRef]
  );

  const readSave = useCallback((): unknown => {
    try {
      const raw = localStorage.getItem(saveKey);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }, [saveKey]);

  const clearSave = useCallback(() => {
    try {
      localStorage.removeItem(saveKey);
    } catch {
      /* 隐私模式下删不掉也不该让页面崩 */
    }
  }, [saveKey]);

  useEffect(() => {
    const onMsg = (e: MessageEvent): void => {
      // 只认自己那个 iframe 发来的消息
      if (e.source !== frameRef.current?.contentWindow) return;
      const data = e.data as { type?: string; data?: unknown };
      if (data?.type === "wgp:ready") {
        setReady(true);
      } else if (data?.type === "wgp:save") {
        try {
          localStorage.setItem(saveKey, JSON.stringify(data.data ?? null));
        } catch {
          // 隐私模式/存储满：存不下就算了，不该让游戏崩
        }
      } else if (data?.type === "wgp:load") {
        post({ type: "wgp:loaded", data: readSave() });
      } else if (data?.type === "wgp:clear") {
        clearSave();
      } else if (data?.type === "wgp:error") {
        // 作品在浏览器里抛异常了。快速模式有三级校验当场打回，自由模式全靠这条路：
        // 送回服务端存起来，AI 下一轮的上下文里就会自动出现【运行报错】。
        const err = (data.data ?? {}) as { message?: string; stack?: string; source?: string };
        if (err.message) {
          onErrorRef.current?.({
            message: err.message,
            stack: err.stack ?? "",
            source: err.source ?? "",
          });
          void fetch(`/api/games/${gameId}/errors`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(err),
            keepalive: true,
          }).catch(() => {
            /* 报错通道自己出错不该再惊动作者 */
          });
        }
      }
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, [post, readSave, clearSave, saveKey, gameId, frameRef]);

  // 竞态兜底：iframe 常常在 React 水合之前就 load 完，游戏那一句 wgp:ready 与
  // wgp:load 发出来时外壳还没挂上监听——两条都会石沉大海，结果是遮罩不散、
  // 存档不回来（而且 onLoad 也不会补发，load 事件早过去了）。
  // 所以挂载后主动补两次：把存档推给游戏，并给遮罩一个时间下限。
  // 这两次补发都在第一秒内，玩家还来不及点任何东西，不会盖掉新进度。
  useEffect(() => {
    const timers = [
      setTimeout(() => post({ type: "wgp:loaded", data: readSave() }), 250),
      setTimeout(() => post({ type: "wgp:loaded", data: readSave() }), 900),
      setTimeout(() => setReady(true), 1500),
    ];
    return () => timers.forEach(clearTimeout);
  }, [post, readSave]);

  return { ready, clearSave, markReady: () => setReady(true) };
}
