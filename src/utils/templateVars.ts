// 快捷指令 / 斜杠指令 的 {{变量}} 替换
// 支持：{{selection}} {{note-title}} {{note-path}} {{note-content}} {{date}} {{time}} {{clipboard}}

import { App, TFile, MarkdownView } from "obsidian";

export interface TemplateVarContext {
  app: App;
  note: TFile | null;
}

const VAR_RE = /\{\{\s*([a-zA-Z][a-zA-Z0-9_-]*)\s*\}\}/g;

function pad2(n: number): string { return n < 10 ? "0" + n : String(n); }

/** 替换所有支持的 {{变量}}。未知变量原样保留。 */
export async function applyTemplateVars(prompt: string, ctx: TemplateVarContext): Promise<string> {
  if (!prompt.includes("{{")) return prompt;
  const { app, note } = ctx;

  // 预取：selection / note-content / clipboard 都可能异步
  let selection = "";
  try {
    // 优先：activeEditor（当前焦点在编辑器时）
    let editor: any = (app.workspace as any).activeEditor?.editor;
    // 兜底：最近一个 markdown 视图（焦点已切到侧栏也能拿到）
    if (!editor) {
      const view = app.workspace.getActiveViewOfType(MarkdownView);
      if (view) editor = view.editor;
    }
    if (!editor) {
      const leaves = app.workspace.getLeavesOfType("markdown");
      const leaf = leaves.find(l => (l.view as any)?.editor);
      if (leaf) editor = (leaf.view as any).editor;
    }
    if (editor && typeof editor.getSelection === "function") {
      selection = editor.getSelection() || "";
    }
    // 阅读模式（Preview）没有 editor.getSelection —— 用浏览器原生 Selection API 兜底
    if (!selection) {
      const sel = window.getSelection();
      if (sel && sel.rangeCount > 0) {
        const raw = sel.toString();
        if (raw && raw.trim()) {
          // 只保留"来自 markdown preview / reading view"的选中，避免把侧栏聊天里的高亮误当选中
          const anchor = sel.anchorNode as Node | null;
          const inPreview = anchor && (anchor.nodeType === 1
            ? (anchor as Element).closest(".markdown-preview-view, .markdown-reading-view, .markdown-rendered")
            : anchor.parentElement?.closest(".markdown-preview-view, .markdown-reading-view, .markdown-rendered"));
          if (inPreview) selection = raw;
        }
      }
    }
  } catch { /* ignore */ }

  let noteContent: string | null = null;
  const needsContent = /\{\{\s*note-content\s*\}\}/.test(prompt);
  if (needsContent && note) {
    try { noteContent = await app.vault.cachedRead(note); } catch { noteContent = ""; }
  }

  let clipboard: string | null = null;
  const needsClip = /\{\{\s*clipboard\s*\}\}/.test(prompt);
  if (needsClip) {
    try { clipboard = await navigator.clipboard.readText(); } catch { clipboard = ""; }
  }

  const now = new Date();
  const date = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
  const time = `${pad2(now.getHours())}:${pad2(now.getMinutes())}`;

  return prompt.replace(VAR_RE, (m, key: string) => {
    switch (key.toLowerCase()) {
      case "selection":    return selection;
      case "note-title":
      case "note_title":
      case "title":        return note?.basename || "";
      case "note-path":
      case "note_path":
      case "path":         return note?.path || "";
      case "note-content":
      case "note_content":
      case "content":      return noteContent ?? "";
      case "date":         return date;
      case "time":         return time;
      case "clipboard":    return clipboard ?? "";
      default:             return m;   // 未知变量原样
    }
  });
}

/** 检测 prompt 里用到、但实际取回空字符串的变量名。用于给用户友好提示。 */
export async function findEmptyVars(prompt: string, ctx: TemplateVarContext): Promise<string[]> {
  const found = new Set<string>();
  const re = /\{\{\s*([a-zA-Z][a-zA-Z0-9_-]*)\s*\}\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(prompt)) !== null) {
    found.add(m[1].toLowerCase());
  }
  if (found.size === 0) return [];
  const empties: string[] = [];
  // 复用 applyTemplateVars 的规则做单变量测试
  for (const key of found) {
    const test = await applyTemplateVars(`{{${key}}}`, ctx);
    if (!test) empties.push(key);
  }
  return empties;
}
