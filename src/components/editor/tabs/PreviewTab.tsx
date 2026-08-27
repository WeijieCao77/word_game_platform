"use client";

import { useEffect, useRef, useState } from "react";
import GamePlayer from "@/components/GamePlayer";
import { useGameFrameBridge } from "@/components/game-frame";
import { GameConfig } from "@/lib/schema";

// 预览试玩页签：直接嵌玩家页那一个 GamePlayer——编辑器与播放器同源，
// 作者看到的就是玩家看到的。有校验错误时不渲染播放器，改去看「校验」页。
// previewNonce 变化即重挂载播放器（应用新配置后从头开一局）。
//
// 自由模式的作品没有通用播放器可嵌——它自带一套页面，跑在沙箱 iframe 里，
// 所以这里直接嵌那个沙箱地址（带编辑钥匙，未发布也看得到）。

export default function PreviewTab({
  config,
  gameId,
  errorCount,
  previewNonce,
  mode = "engine",
  editKey = "",
  onFixError,
}: {
  config: GameConfig;
  gameId: string;
  errorCount: number;
  previewNonce: number;
  mode?: "engine" | "code";
  editKey?: string;
  /** 「让 AI 去修」——把报错原文直接发给 AI，作者不用自己抄 */
  onFixError?: (message: string) => void;
}): React.ReactElement {
  if (mode === "code") {
    return <CodePreview gameId={gameId} editKey={editKey} nonce={previewNonce} onFixError={onFixError} />;
  }
  if (errorCount > 0) {
    return <div className="pane-note">配置存在 {errorCount} 个错误，修复后即可预览（见「校验」页）。</div>;
  }
  return (
    <div className="preview-frame">
      <GamePlayer key={previewNonce} config={config} gameId={gameId} mode="preview" />
    </div>
  );
}

/**
 * 自由模式的预览。
 *
 * 先去换一张预览通行证（httpOnly cookie）再加载 iframe——不能靠 ?k=：
 * index.html 里相对引用的 style.css / game.js，浏览器发子请求时不会带上查询串，
 * 那些文件会全部 403，作者看到一张裸页还以为 AI 写坏了。
 * 顺带的好处是钥匙不再出现在 iframe 的 location 里，作者的代码读不到它。
 */
function CodePreview({
  gameId,
  editKey,
  nonce,
  onFixError,
}: {
  gameId: string;
  editKey: string;
  nonce: number;
  onFixError?: (message: string) => void;
}): React.ReactElement {
  const [token, setToken] = useState("");
  const [err, setErr] = useState("");
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [crash, setCrash] = useState<{ message: string; source: string } | null>(null);
  // 预览也走跟玩家页一模一样的外壳协议：存档存得下、要得回，抛的异常送回服务端。
  // 以前这里什么都不接——作者预览里那条血红横幅，服务端一无所知，
  // AI 下一轮读到的是「没有报错记录」，于是坦然宣布做好了。
  //
  // 存档另开一个键：作者在预览里试玩，不该把自己正式那一局的进度冲掉。
  useGameFrameBridge({
    gameId,
    frameRef,
    saveKey: `wgp_codepreview_${gameId}`,
    onError: (e) => setCrash({ message: e.message, source: e.source }),
  });

  // 换了一版就把旧报错收起来——不然作者会盯着一条已经修好的错发愁
  useEffect(() => setCrash(null), [nonce]);

  useEffect(() => {
    let alive = true;
    setToken("");
    setErr("");
    void fetch(`/api/games/${gameId}/preview`, {
      method: "POST",
      headers: { "x-edit-key": editKey },
    })
      .then(async (r) => {
        if (!alive) return;
        if (!r.ok) {
          setErr("拿不到预览权限，刷新页面试试");
          return;
        }
        setToken(((await r.json()) as { token?: string }).token ?? "");
      })
      .catch(() => alive && setErr("预览请求失败，检查一下网络"));
    return () => {
      alive = false;
    };
  }, [gameId, editKey, nonce]);

  if (err) return <div className="pane-note">{err}</div>;
  if (!token) return <div className="pane-note">正在打开预览…</div>;
  return (
    <div className="preview-frame preview-code">
      {crash && (
        <div className="preview-crash">
          <div className="preview-crash-title">这一版打不开：{crash.message}</div>
          {crash.source && <div className="preview-crash-where">{crash.source}</div>}
          {onFixError && (
            <button
              className="btn btn-sm"
              onClick={() => {
                onFixError(
                  `预览打不开，报错是：${crash.message}${crash.source ? `（${crash.source}）` : ""}。` +
                    "先把它修好，把出错那条路径从头走一遍确认不会再抛，再说别的。"
                );
                setCrash(null);
              }}
            >
              让 AI 去修
            </button>
          )}
        </div>
      )}
      <iframe
        key={nonce}
        ref={frameRef}
        className="preview-code-frame"
        src={`/play/${gameId}/k~${token}/index.html?n=${nonce}`}
        title="预览"
        // 跟正式游玩页一样的沙箱：不给 allow-same-origin，作者预览到的
        // 就是玩家会遇到的那个环境
        sandbox="allow-scripts"
      />
    </div>
  );
}
