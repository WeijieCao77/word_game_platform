"use client";

import { ROLE_CLASS, STAGE_STEPS, STAGE_VIEW } from "./stages";
import { ChatMsg } from "./types";

// 工作台左半边：和 AI 驻场工作室对话的地方，也是整个产品的主入口。
// 从上到下三块——阶段条（走到哪一步、谁在服务你）、消息流（按【职能】拆段带徽章）、输入框。
// 改对话区长什么样 → 只看这里；对话怎么发、AI 回什么 → 在 page.tsx 与 /api/games/:id/assistant。

/** 顶部阶段条：设计卡状态决定高亮到第几步、列出哪些职能 */
function StageBar({ cardStatus }: { cardStatus: string }): React.ReactElement {
  const view = STAGE_VIEW[cardStatus] ?? STAGE_VIEW["需求对齐中"];
  return (
    <div className="chat-stagebar" title="创作流程：创意对齐 → 方案确认 → 搭建 → 调优">
      <div className="stage-steps">
        {STAGE_STEPS.map((s, i) => (
          <span key={s} className={`stage-step ${i === view.step ? "active" : i < view.step ? "done" : ""}`}>
            {i < view.step ? "✓ " : ""}
            {s}
          </span>
        ))}
      </div>
      <div className="stage-hint">
        <span>正在服务：</span>
        {view.roles.map((r) => (
          <span key={r} className={`role-chip ${ROLE_CLASS[r]}`}>
            {r}
          </span>
        ))}
        <span className="stage-hint-text">{view.hint}</span>
      </div>
    </div>
  );
}

/** 把 AI 消息按【职能】署名拆段，渲染成带徽章的段落 */
function AssistantMsg({ content }: { content: string }): React.ReactElement {
  const parts = content.split(/(?=【(?:主策|剧情|人设|数值)】)/g).filter((p) => p.trim());
  if (parts.length <= 1 && !/^【/.test(content.trim())) {
    return <div className="chat-msg assistant">{content}</div>;
  }
  return (
    <div className="chat-msg assistant">
      {parts.map((p, i) => {
        const m = p.match(/^【(主策|剧情|人设|数值)】\s*/);
        if (!m) return <div key={i}>{p}</div>;
        return (
          <div key={i} className="role-seg">
            <span className={`role-chip ${ROLE_CLASS[m[1]]}`}>{m[1]}</span>
            {p.slice(m[0].length)}
          </div>
        );
      })}
    </div>
  );
}

export default function ChatPane({
  cardStatus,
  chat,
  chatBusy,
  chatSeconds,
  chatInput,
  onChatInput,
  onSend,
  chatEndRef,
}: {
  cardStatus: string;
  chat: ChatMsg[];
  chatBusy: boolean;
  /** AI 工作中已等待的秒数，超过 15 秒补一句「这是正常的」安抚 */
  chatSeconds: number;
  chatInput: string;
  onChatInput: (value: string) => void;
  onSend: () => void;
  chatEndRef: React.RefObject<HTMLDivElement | null>;
}): React.ReactElement {
  return (
    <div className="chat-pane">
      <StageBar cardStatus={cardStatus} />
      <div className="chat-log">
        {chat.length === 0 && (
          <div className="chat-msg assistant">
            这里是你的驻场游戏工作室——【主策】【剧情】【人设】【数值】四个职能为你服务，
            你是老板：出想法、提方向、拍板就行，专业的事我们补全。
            {"\n\n"}流程：先聊需求（题材基调、角色、玩法循环、结局）→ 我们给完整方案 →
            你点头后才动手搭建 → 一起试玩调优。聊定的共识都记在「设计卡」页签里。
            {"\n\n"}跟我们说说你想做什么——一个题材、一部小说的感觉、或者一个模糊的念头都行。
          </div>
        )}
        {chat.map((m, i) =>
          m.role === "assistant" ? (
            <AssistantMsg key={i} content={m.content} />
          ) : (
            <div key={i} className={`chat-msg ${m.role}`}>
              {m.content}
            </div>
          )
        )}
        {chatBusy && (
          <div className="chat-msg system">
            AI 策划工作中… {chatSeconds}s{chatSeconds > 15 ? "（生成/修改配置通常要 30~120 秒，它可能正在跑校验和模拟）" : ""}
          </div>
        )}
        <div ref={chatEndRef} />
      </div>
      <div className="chat-input">
        <textarea
          value={chatInput}
          placeholder="例：把这个游戏改成宗门经营题材，加一条叛徒线（Ctrl+Enter 发送）"
          onChange={(e) => onChatInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) onSend();
          }}
        />
        <button className="btn" disabled={chatBusy} onClick={() => onSend()}>
          发送
        </button>
      </div>
    </div>
  );
}
