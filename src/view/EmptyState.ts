// 空状态渲染 —— 从 ChatPanel 抽出

export type EmptyKind = "connecting" | "no-note" | "no-messages";

const KIND_CFG: Record<EmptyKind, { icon: string; title: string; hint: string; withCards?: boolean }> = {
  "connecting": { icon: "⏳", title: "正在连接 Codex", hint: "请稍候…" },
  "no-note":    { icon: "📓", title: "打开一个笔记开始", hint: "我会自动看到你正在读的内容" },
  "no-messages":{ icon: "✨", title: "开始对话", hint: "试试下面这些操作 · 或直接在输入框问我", withCards: true },
};

const CARDS = [
  { kbd: "@",   label: "引用一篇笔记" },
  { kbd: "/",   label: "选择斜杠指令" },
  { kbd: "⌘ F", label: "搜索对话历史" },
  { kbd: "⌘ ⏎", label: "发送消息" },
];

export function renderEmptyState(container: HTMLElement, kind: EmptyKind): void {
  const cfg = KIND_CFG[kind];
  const empty = container.createDiv({ cls: "ai-assistant-empty" });
  empty.createDiv({ cls: "ai-assistant-empty-icon", text: cfg.icon });
  empty.createDiv({ cls: "ai-assistant-empty-title", text: cfg.title });
  empty.createDiv({ cls: "ai-assistant-empty-hint", text: cfg.hint });
  if (!cfg.withCards) return;
  const cards = empty.createDiv({ cls: "ai-assistant-empty-cards" });
  for (const cd of CARDS) {
    const card = cards.createDiv({ cls: "ai-assistant-empty-card" });
    card.createSpan({ cls: "ai-assistant-empty-card-kbd", text: cd.kbd });
    card.createSpan({ cls: "ai-assistant-empty-card-label", text: cd.label });
  }
}
