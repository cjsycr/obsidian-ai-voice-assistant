// InlineEditController: 内联编辑编排
// 流程：捕获选区 → 指令输入 Modal → 调 Codex → 解析回复 → 审查 Modal → 应用

import { Editor, MarkdownView, Notice, App } from "obsidian";
import { CodexClient } from "../codex/CodexClient";
import { getVaultBasePath } from "../utils/vault";
import { getInlineEditSystemPrompt, extractInlineEditResponse, buildInlineEditReview, InlineEditMode, InlineEditExtraction } from "../prompt/inline-edit";
import { InlineEditInstructionModal, InlineEditReviewModal } from "./InlineEditModal";

interface EditSnapshot {
  editor: Editor;
  mode: InlineEditMode;
  notePath: string;
  documentText: string;
  originalText: string;
  rangeFrom: { line: number; ch: number };
  rangeTo: { line: number; ch: number };
  rangeStartOffset: number;
  rangeEndOffset: number;
}

/** 捕获编辑器当前快照 */
function captureSnapshot(app: App, mode: InlineEditMode): EditSnapshot | null {
  const view = app.workspace.getActiveViewOfType(MarkdownView);
  const file = view?.file;
  const editor = view?.editor;

  if (!view || !file || !editor) {
    new Notice("请先打开一个 Markdown 编辑器。", 6000);
    return null;
  }

  if (editor.listSelections().length !== 1) {
    new Notice("内联编辑当前只支持单选区或单光标。", 6000);
    return null;
  }

  const documentText = editor.getValue();
  const rangeFrom = mode === "rewrite-selection" ? editor.getCursor("from") : editor.getCursor("head");
  const rangeTo = mode === "rewrite-selection" ? editor.getCursor("to") : rangeFrom;
  const originalText = mode === "rewrite-selection" ? editor.getSelection() : "";

  if (mode === "rewrite-selection" && !originalText.trim()) {
    new Notice("请先选中文本再运行改写。", 6000);
    return null;
  }

  return {
    editor,
    mode,
    notePath: file.path,
    documentText,
    originalText,
    rangeFrom,
    rangeTo,
    rangeStartOffset: editor.posToOffset(rangeFrom),
    rangeEndOffset: editor.posToOffset(rangeTo),
  };
}

/** 发送 prompt 给 Codex 并等待回复（异步等待 turn/completed 通知） */
/** 发送 prompt 给 Codex 并等待回复 */
async function generateEdit(
  app: App,
  client: CodexClient,
  service: any,
  snapshot: EditSnapshot,
  instruction: string,
): Promise<InlineEditExtraction> {
  const prompt = [
    getInlineEditSystemPrompt(),
    "---",
    snapshot.mode === "rewrite-selection" ? "任务：改写选中文本。" : "任务：在光标处生成文本插入。",
    `指令：${instruction}`,
    `笔记路径：${snapshot.notePath}`,
    snapshot.mode === "rewrite-selection"
      ? `选中文本：\n${snapshot.originalText}`
      : `光标位置：${snapshot.notePath}:${snapshot.rangeFrom.line + 1}:${snapshot.rangeFrom.ch + 1}`,
    "只输出最终文本，不要包含任何解释。",
  ].join("\n\n");

  // 使用现有 thread 而不是创建 ephemeral thread（避免 hook 插件干扰）
  const currentThread = service?.getCurrentThread?.();
  let threadId: string;
  let cwd: string;

  if (currentThread) {
    threadId = currentThread.id;
    cwd = currentThread.cwd;
  } else {
    // 没有现有 thread，fallback 创建 ephemeral
    const vaultRoot = getVaultBasePath(app);
    cwd = vaultRoot || "/";
    const threadRes = await client.threadStart({ cwd, ephemeral: true });
    threadId = threadRes.thread.id;
  }

  // 收集 agentMessage delta 文本
  let accumulatedText = "";
  let turnId = "";

  const turnRes = await client.turnStart({
    threadId,
    input: [{ type: "text", text: prompt }],
    cwd,
  });
  turnId = turnRes.turn?.id || "";

  // 如果 turn 已经同步完成，直接从 items 提取
  if (turnRes.turn?.items && turnRes.turn.items.length > 0) {
    for (const item of turnRes.turn.items) {
      if (item.type === "agentMessage") {
        const text = (item as any).text || (item as any).content?.[0]?.text || "";
        if (text.trim()) return extractInlineEditResponse(text);
      }
    }
  }

  // 否则等待异步通知
  const result = await new Promise<InlineEditExtraction | null>((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error("内联编辑超时（60s）"));
    }, 60000);

    const deltaHandler = (params: any) => {
      if (params.threadId === threadId && (!turnId || params.turnId === turnId)) {
        accumulatedText += params.delta || "";
      }
    };

    const completeHandler = (params: { threadId: string; turn: any }) => {
      if (params.threadId === threadId) {
        clearTimeout(timeout);
        cleanup();

        // 优先用 accumulatedText（来自 delta 流式）
        if (accumulatedText.trim()) {
          resolve(extractInlineEditResponse(accumulatedText));
          return;
        }

        // fallback：从 turn items 提取
        if (params.turn?.items) {
          for (const item of params.turn.items) {
            if (item.type === "agentMessage") {
              const text = (item as any).text || (item as any).content?.[0]?.text || "";
              if (text.trim()) {
                resolve(extractInlineEditResponse(text));
                return;
              }
            }
          }
        }

        resolve(null);
      }
    };

    const cleanup = () => {
      client.off("agentMessageDelta", deltaHandler);
      client.off("turnCompleted", completeHandler);
    };

    client.on("agentMessageDelta", deltaHandler);
    client.on("turnCompleted", completeHandler);
  });

  if (result) return result;
  return { kind: "raw", text: "" };
}

/** 应用编辑结果到编辑器 */
function applyEdit(snapshot: EditSnapshot, proposedText: string): void {
  // 文档变化检测
  if (snapshot.editor.getValue() !== snapshot.documentText) {
    new Notice("文档在等待期间已变化，请重新运行内联编辑以避免覆盖。", 8000);
    return;
  }

  if (snapshot.mode === "rewrite-selection") {
    snapshot.editor.replaceRange(proposedText, snapshot.rangeFrom, snapshot.rangeTo);
    // 选中替换后的文本
    const nextEnd = snapshot.editor.offsetToPos(
      snapshot.editor.posToOffset(snapshot.rangeFrom) + proposedText.length
    );
    snapshot.editor.setSelection(snapshot.rangeFrom, nextEnd);
    snapshot.editor.scrollIntoView({ from: snapshot.rangeFrom, to: nextEnd }, true);
  } else {
    snapshot.editor.replaceRange(proposedText, snapshot.rangeFrom, snapshot.rangeFrom);
    const insertEnd = snapshot.editor.offsetToPos(
      snapshot.editor.posToOffset(snapshot.rangeFrom) + proposedText.length
    );
    snapshot.editor.setSelection(snapshot.rangeFrom, insertEnd);
    snapshot.editor.scrollIntoView({ from: snapshot.rangeFrom, to: insertEnd }, true);
  }

  snapshot.editor.focus();
}

/** 主入口：运行内联编辑 */
export async function runInlineEdit(app: App, client: CodexClient, mode: InlineEditMode, service?: any): Promise<void> {
  // 1. 捕获快照
  const snapshot = captureSnapshot(app, mode);
  if (!snapshot) return;

  // 2. 指令输入 Modal
  const instruction = await new InlineEditInstructionModal(app, mode).waitForInstruction();
  if (!instruction) return;

  new Notice("正在生成编辑结果…", 3000);

  // 3. 调 Codex
  let extraction: InlineEditExtraction;
  try {
    extraction = await generateEdit(app, client, service, snapshot, instruction);
  } catch (e: any) {
    new Notice(`内联编辑失败: ${e.message}`, 8000);
    return;
  }

  // 4. 处理澄清请求
  if (extraction.kind === "clarification") {
    new Notice(`AI 需要更多信息: ${extraction.text}`, 8000);
    return;
  }

  const proposedText = extraction.text;
  if (!proposedText.trim()) {
    new Notice("内联编辑返回了空内容。", 6000);
    return;
  }

  // 5. 审查 Modal
  const review = buildInlineEditReview({
    mode,
    originalText: snapshot.originalText,
    proposedText,
  });
  const confirmed = await new InlineEditReviewModal(app, review).waitForDecision();
  if (!confirmed) return;

  // 6. 应用
  applyEdit(snapshot, proposedText);
  new Notice("✓ 已应用编辑", 2000);
}
