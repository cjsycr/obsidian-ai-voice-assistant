// Inline Edit 专用 prompt 构建 & 回复解析
// 灵感来自 Codexian，保留 XML 标签解析 + 单代码块 fallback

export type InlineEditMode = "rewrite-selection" | "insert-at-cursor";

const CONTEXT_RADIUS = 240;

/** 从文档中截取选区/光标前后文 */
function sliceContext(text: string, start: number, end: number): {
  before: string; current: string; after: string;
} {
  const safeStart = Math.max(0, Math.min(start, text.length));
  const safeEnd = Math.max(safeStart, Math.min(end, text.length));
  return {
    before: text.slice(Math.max(0, safeStart - CONTEXT_RADIUS), safeStart).trim(),
    current: text.slice(safeStart, safeEnd),
    after: text.slice(safeEnd, Math.min(text.length, safeEnd + CONTEXT_RADIUS)).trim(),
  };
}

/** 构建发送给 Codex 的 prompt */
export function buildInlineEditPrompt(input: {
  mode: InlineEditMode;
  instruction: string;
  notePath?: string;
  documentText: string;
  rangeStart: number;
  rangeEnd: number;
}): string {
  const ctx = sliceContext(input.documentText, input.rangeStart, input.rangeEnd);
  const sections: string[] = [];

  // 系统指令
  sections.push(getInlineEditSystemPrompt());
  sections.push("---");

  // 任务描述
  sections.push(
    input.mode === "rewrite-selection"
      ? "任务：改写选中文本。"
      : "任务：在光标处生成文本插入。"
  );
  sections.push(`指令：${input.instruction.trim()}`);

  if (input.notePath) {
    sections.push(`笔记路径：${input.notePath}`);
  }

  // 上下文
  if (input.mode === "rewrite-selection") {
    if (ctx.before) sections.push(`选中文本前：\n${ctx.before}`);
    sections.push(`选中文本：\n${ctx.current}`);
    if (ctx.after) sections.push(`选中文本后：\n${ctx.after}`);
    sections.push("除非指令另有说明，请保持原文的语言、语气和 Markdown 结构。");
    sections.push("只返回替换后的文本，不要包含任何解释。");
  } else {
    if (ctx.before) sections.push(`光标前：\n${ctx.before}`);
    if (ctx.after) sections.push(`光标后：\n${ctx.after}`);
    sections.push("请匹配附近文本的语言、语气和 Markdown 结构。");
    sections.push("只返回要插入的文本，不要包含任何解释。");
  }

  return sections.join("\n\n");
}

/** 系统 prompt */
export function getInlineEditSystemPrompt(): string {
  return [
    "你是嵌入在 Obsidian 中的专业编辑助手。",
    "",
    "## 核心规则",
    "",
    "1. **匹配风格**：除非指令明确要求，否则保持原文的语言、语气、格式和 Markdown 结构。",
    "2. **上下文感知**：利用周围文本理解自然的内容衔接。",
    "3. **只输出结果**：不要输出过程描述，不要输出\"让我看看…\"之类的思考过程。",
    "4. **无废话**：只输出最终文本。不要前言，不要解释，不要署名。",
    "",
    "## 模式",
    "",
    "### 改写模式 (rewrite-selection)",
    "用户选中了一段文本并希望改写。",
    "- 输出包装在 `<replacement>` 标签内：`<replacement>改写后的文本</replacement>`",
    "- 不要包含周围上下文。",
    "",
    "### 插入模式 (insert-at-cursor)",
    "用户希望在光标处插入文本。",
    "- 输出包装在 `<insertion>` 标签内：`<insertion>要插入的文本</insertion>`",
    "- 文本应与周围内容自然衔接。",
    "",
    "### 需要澄清",
    "如果指令太模糊无法产生有用输出，用 `<clarification>` 标签返回澄清问题。",
    "例如：`<clarification>请指定改写的目标读者？</clarification>`",
    "",
    "## 示例",
    "",
    "指令：翻译成英文",
    "选中文本：这是一个关于机器学习的笔记",
    "输出：<replacement>This is a note about machine learning</replacement>",
  ].join("\n");
}

/** 解析 AI 回复 */
export interface InlineEditExtraction {
  kind: "replacement" | "insertion" | "clarification" | "raw";
  text: string;
}

const REPLACEMENT_RE = /<replacement>([\s\S]*?)<\/replacement>/;
const INSERTION_RE = /<insertion>([\s\S]*?)<\/insertion>/;
const CLARIFICATION_RE = /<clarification>([\s\S]*?)<\/clarification>/;
const SINGLE_FENCED_RE = /^```(?:[\w-]+)?\r?\n([\s\S]*?)\r?\n```$/;

export function extractInlineEditResponse(response: string): InlineEditExtraction {
  const trimmed = response.trim();

  const m1 = trimmed.match(REPLACEMENT_RE);
  if (m1) return { kind: "replacement", text: m1[1] ?? "" };

  const m2 = trimmed.match(INSERTION_RE);
  if (m2) return { kind: "insertion", text: m2[1] ?? "" };

  const m3 = trimmed.match(CLARIFICATION_RE);
  if (m3) return { kind: "clarification", text: m3[1]?.trim() ?? "" };

  // 单代码块 fallback
  const fenced = trimmed.match(SINGLE_FENCED_RE);
  if (fenced) return { kind: "raw", text: fenced[1]?.trim() ?? "" };

  return { kind: "raw", text: trimmed };
}

/** 为预览 Modal 构建对比模型 */
export function buildInlineEditReview(input: {
  mode: InlineEditMode;
  originalText: string;
  proposedText: string;
}): { title: string; originalLabel: string; proposedLabel: string; applyLabel: string; originalText: string; proposedText: string } {
  if (input.mode === "rewrite-selection") {
    return {
      title: "审查改写结果",
      originalLabel: "当前选中",
      proposedLabel: "改写方案",
      applyLabel: "替换选中",
      originalText: input.originalText,
      proposedText: input.proposedText,
    };
  }
  return {
    title: "审查插入内容",
    originalLabel: "光标上下文",
    proposedLabel: "待插入文本",
    applyLabel: "插入文本",
    originalText: input.originalText,
    proposedText: input.proposedText,
  };
}
