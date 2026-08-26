"use client";

import { ROLE_CLASS, STAGE_STEPS, STAGE_VIEW } from "./stages";
import { ChatMsg } from "./types";
import { fmtWan } from "@/lib/format";

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


/**
 * 等待提示按真实耗时分档。聊方案通常十几秒，搭建整份配置要写卡片 → 校验 → 跑几百局模拟，
 * 两三分钟很正常——用一个固定区间套所有情况，超了就显得平台出故障了。
 */
function waitingHint(sec: number): string {
  if (sec <= 15) return "";
  if (sec <= 60) return "（聊方案通常十几秒；要动配置的话会久一些，它可能正在跑校验和模拟）";
  if (sec <= 150) return "（正在搭建配置：写卡片 → 校验 → 跑几百局模拟，两三分钟都算正常）";
  if (sec <= 300) return "（这轮改动比较大，还在迭代配平——校验没过它会自己重来）";
  // 这一轮跑在后台，不是挂在这个网页上：关掉页面它照样干完，回来还能接上。
  // 以前这里写的是「可能卡住了，刷新重发」——那是同步时代的话，现在重发只会白烧一轮。
  return "（这一轮在服务端后台跑，关页面也不会中断；回来打开就能看到结果，别重发）";
}

export interface QuotaInfo {
  kind: "admin" | "user" | "guest";
  unlimited: boolean;
  used: number;
  limit: number;
  remaining: number;
  requests: number;
  maxRequests: number;
}


/**
 * 输入框下面的额度计数器。
 * 额度给得很足（正常创作根本用不完），但不能让人心里没数——
 * 「我用了多少」本身就是信息，何况用完了要走审批。
 */
function QuotaMeter({ quota }: { quota: QuotaInfo | null }): React.ReactElement | null {
  if (!quota) return null;
  if (quota.unlimited) {
    return <div className="quota-meter">管理员 · 不限量　累计已用 {fmtWan(quota.used)} tokens</div>;
  }
  const pct = quota.limit > 0 ? Math.min(100, Math.round((quota.used / quota.limit) * 100)) : 0;
  const low = quota.limit > 0 && quota.remaining <= quota.limit * 0.1;
  return (
    <div className={`quota-meter${low ? " low" : ""}`}>
      <span className="quota-bar" aria-hidden>
        <span className="quota-bar-fill" style={{ width: `${pct}%` }} />
      </span>
      <span>
        {quota.kind === "guest" ? "今日额度" : "AI 额度"} {fmtWan(quota.used)} / {fmtWan(quota.limit)}
        　剩 {fmtWan(quota.remaining)}
      </span>
      {quota.kind === "guest" && <span className="quota-note">注册后额度大得多</span>}
      {low && quota.kind === "user" && <span className="quota-note">用完会自动向管理员申请</span>}
    </div>
  );
}

export default function ChatPane({
  cardStatus,
  chat,
  chatBusy,
  chatSeconds,
  jobNote,
  chatInput,
  onChatInput,
  onSend,
  chatEndRef,
  quota,
}: {
  cardStatus: string;
  chat: ChatMsg[];
  chatBusy: boolean;
  /** AI 工作中已等待的秒数，超过 15 秒补一句「这是正常的」安抚 */
  chatSeconds: number;
  /** 后台那一轮干到哪一步了（异步模式下服务端实时报上来，比干等一个转圈强得多） */
  jobNote?: string;
  chatInput: string;
  onChatInput: (value: string) => void;
  onSend: () => void;
  chatEndRef: React.RefObject<HTMLDivElement | null>;
  /** 额度读数；null 表示还没取到 */
  quota: QuotaInfo | null;
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
            AI 策划工作中… {chatSeconds}s
            {jobNote ? `　${jobNote}` : ""}
            {waitingHint(chatSeconds)}
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
      <QuotaMeter quota={quota} />
    </div>
  );
}
