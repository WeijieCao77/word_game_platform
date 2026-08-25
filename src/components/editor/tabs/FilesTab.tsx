"use client";

import { useCallback, useEffect, useState } from "react";

// 文件页签：自由模式专用。
//
// 作者不写代码，但他有权看见 AI 到底改了什么——「说生效却什么都没变」这种事
// 只能靠把文件摊在他面前来防。这里只做「看得见、能删、能刷新预览」，
// 编辑仍然交给 AI（真要手改，文本框也在这儿）。

export interface FileItem {
  path: string;
  size: number;
  updatedAt: string;
}

export default function FilesTab({
  gameId,
  editKey,
  files,
  onReload,
  onPreviewRefresh,
}: {
  gameId: string;
  editKey: string;
  files: FileItem[] | null;
  onReload: () => void;
  onPreviewRefresh: () => void;
}): React.ReactElement {
  const [open, setOpen] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const read = useCallback(
    async (path: string): Promise<void> => {
      setBusy(true);
      setMsg("");
      try {
        const res = await fetch(`/api/games/${gameId}/files?path=${encodeURIComponent(path)}`, {
          headers: { "x-edit-key": editKey },
        });
        const body = await res.json();
        if (!res.ok) throw new Error(body.error ?? "读取失败");
        setOpen(path);
        setText(body.content ?? "");
      } catch (e) {
        setMsg(e instanceof Error ? e.message : "读取失败");
      } finally {
        setBusy(false);
      }
    },
    [gameId, editKey]
  );

  useEffect(() => {
    // 默认展开入口文件，作者一进来就看得到主体
    if (!open && files && files.some((f) => f.path === "index.html")) void read("index.html");
  }, [files, open, read]);

  const save = async (): Promise<void> => {
    if (!open) return;
    setBusy(true);
    setMsg("");
    try {
      const res = await fetch(`/api/games/${gameId}/files`, {
        method: "PUT",
        headers: { "content-type": "application/json", "x-edit-key": editKey },
        body: JSON.stringify({ path: open, content: text }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "保存失败");
      setMsg(`已保存 ${open}`);
      onReload();
      onPreviewRefresh();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "保存失败");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (path: string): Promise<void> => {
    if (!confirm(`删掉 ${path}？删了就没了。`)) return;
    setBusy(true);
    try {
      await fetch(`/api/games/${gameId}/files?path=${encodeURIComponent(path)}`, {
        method: "DELETE",
        headers: { "x-edit-key": editKey },
      });
      if (open === path) {
        setOpen(null);
        setText("");
      }
      onReload();
      onPreviewRefresh();
    } finally {
      setBusy(false);
    }
  };

  if (!files) return <div className="pane-note">正在读文件清单…</div>;
  if (files.length === 0) {
    return (
      <div className="pane-note">
        这部作品还没有文件。自由模式至少要有一个 <code>index.html</code>——
        跟左边的 AI 说「把界面搭起来」，它会写进来。
      </div>
    );
  }

  return (
    <div className="files-tab">
      <div className="files-list">
        {files.map((f) => (
          <div key={f.path} className={`files-row ${open === f.path ? "on" : ""}`}>
            <button className="files-name" onClick={() => void read(f.path)} disabled={busy}>
              {f.path}
            </button>
            <span className="files-size">{f.size.toLocaleString()} 字符</span>
            <button className="linklike" onClick={() => void remove(f.path)} disabled={busy}>
              删除
            </button>
          </div>
        ))}
      </div>

      {open && (
        <div className="files-editor">
          <div className="files-editor-bar">
            <b>{open}</b>
            <span className="files-spacer" />
            {msg && <span className="files-msg">{msg}</span>}
            <button className="btn small" onClick={() => void save()} disabled={busy}>
              保存并刷新预览
            </button>
          </div>
          <textarea
            className="files-text"
            value={text}
            spellCheck={false}
            onChange={(e) => setText(e.target.value)}
          />
        </div>
      )}
    </div>
  );
}
