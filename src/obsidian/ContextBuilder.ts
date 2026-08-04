// 系统上下文构建 & 剥离 —— 从 NoteService 抽出
// 负责：
//   1) buildContext(userText)：把当前 note 路径、同目录笔记、known-repos、
//      custom-instructions、attachments 等打包成一段发给模型的系统前缀 + <user-input>...</user-input>
//   2) stripSystemContext(raw)：从收到的历史消息里剥掉系统包装，
//      还原用户实际输入（用于消息列表展示）

import { App, TFile } from "obsidian";
import { PluginSettings, ComposerAttachment } from "../types";
import { getVaultBasePath } from "../utils/vault";

export interface BuildContextOptions {
  app: App;
  currentNote: TFile | null;
  settings: PluginSettings;
  /** 本轮发送的附件（图片粘贴等） */
  attachments?: ComposerAttachment[];
}

/** 组装附件（图片）的描述文本，插入到 context 中 */
function buildAttachmentsSection(attachments: ComposerAttachment[] | undefined): string {
  if (!attachments || attachments.length === 0) return "";
  const lines: string[] = ["\n<attached-images>"];
  for (const a of attachments) {
    if (a.kind === "pasted-image") {
      const dims = (a.width && a.height) ? `${a.width}x${a.height}` : "unknown";
      lines.push(`- path: ${a.path}`);
      lines.push(`  mime: ${a.mimeType}`);
      lines.push(`  size: ${a.sizeBytes} bytes`);
      lines.push(`  dimensions: ${dims}`);
    }
  }
  lines.push("</attached-images>");
  lines.push("如果这些图片与当前任务相关，请直接用 fs 工具从本地路径读取它们。");
  return lines.join("\n");
}

export function buildContext(userText: string, opts: BuildContextOptions): string {
  const { app, currentNote, settings, attachments } = opts;
  if (!currentNote) return userText;

  const notePath = currentNote.path;
  const vaultRoot = getVaultBasePath(app);
  const folder = currentNote.parent?.path || "";

  const siblings = app.vault.getMarkdownFiles()
    .filter(f => f.parent?.path === folder && f.path !== notePath)
    .slice(0, 10)
    .map(f => f.path);

  let extraInfo = "";
  if (settings.repoLocations && settings.repoLocations.length > 0) {
    extraInfo += "\n<known-repos>\n";
    settings.repoLocations.forEach(r => {
      extraInfo += "- " + r.name + ": " + r.path + "\n";
    });
    extraInfo += "</known-repos>";
  }
  if (settings.customInstructions) {
    extraInfo += "\n<user-custom-instructions>\n" + settings.customInstructions + "\n</user-custom-instructions>";
  }

  const attachmentsSection = buildAttachmentsSection(attachments);

  return `<obsidian-context>
vault_root: ${vaultRoot}
active_note: ${notePath}  (使用 fs/read_file 等工具读取)
active_note_folder: ${folder}
siblings_in_folder: ${JSON.stringify(siblings)}
</obsidian-context>

提示：
- 当前在读 ${notePath}
- 你可以用 fs 工具（如 fs/read_file）读取 vault 下的任何 .md 文件
- 用 ${vaultRoot} 作为根目录${extraInfo}${attachmentsSection}

<user-input>
${userText}
</user-input>`;
}

/** 剥离 buildContext 加上的系统包装，只返回用户实际输入 */
export function stripSystemContext(raw: string): string {
  if (!raw) return raw;
  // 新格式：显式 <user-input>...</user-input> 标签
  const tagMatch = raw.match(/<user-input>\s*([\s\S]*?)\s*<\/user-input>\s*$/);
  if (tagMatch) return tagMatch[1].trim();
  // 旧格式兜底
  if (/^\s*<obsidian-context>/.test(raw)) {
    let s = raw;
    s = s.replace(/^\s*<obsidian-context>[\s\S]*?<\/obsidian-context>\s*/i, "");
    s = s.replace(/^\s*提示：[\s\S]*?(?=\n\s*\n|<user-|<known-|$)/, "");
    s = s.replace(/^\s*<known-repos>[\s\S]*?<\/known-repos>\s*/i, "");
    s = s.replace(/^\s*<user-custom-instructions>[\s\S]*?<\/user-custom-instructions>\s*/i, "");
    // 剥离 <attached-images> 标签
    s = s.replace(/^\s*<attached-images>[\s\S]*?<\/attached-images>\s*/i, "");
    return s.trim();
  }
  return raw;
}
