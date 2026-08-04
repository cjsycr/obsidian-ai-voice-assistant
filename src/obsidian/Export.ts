// 消息导出模块 —— 从 NoteService 抽出
// 负责：把选中的 ChatMessage[] 生成 Markdown 并写到 vault 的导出文件夹

import { App, TFile } from "obsidian";
import { ChatMessage } from "../types";
import { getVaultBasePath } from "../utils/vault";

export interface ExportOptions {
  app: App;
  currentNote: TFile | null;
  exportFolder?: string;
}

export async function exportSelectedMessages(
  messages: ChatMessage[],
  opts: ExportOptions,
): Promise<string> {
  const selectedMsgs = messages.filter(m => m.selected && m.role !== "system");
  if (selectedMsgs.length === 0) {
    throw new Error("没有选中的消息");
  }
  const noteName = opts.currentNote ? opts.currentNote.basename : "未命名";
  const date = new Date().toISOString().slice(0, 10);
  const filename = `codex-export-${date}-${noteName}.md`;

  const dateStr = new Date().toLocaleString("zh-CN");
  let mdContent = `# 导出对话 - ${noteName}\n\n日期：${dateStr}\n\n---\n\n`;
  for (const m of selectedMsgs) {
    mdContent += `**${m.role === "user" ? "你" : "AI"}**\n\n`;
    if (m.reasoning) {
      mdContent += `<details><summary>💭 思考过程</summary>\n\n${m.reasoning}\n\n</details>\n\n`;
    }
    mdContent += `${m.content || ""}\n\n---\n\n`;
  }

  const exportFolder = (opts.exportFolder || "exports").trim();
  const vaultRelativePath = (!exportFolder || exportFolder === "/" || exportFolder === ".")
    ? filename
    : exportFolder + "/" + filename;
  const pathMod = require("path");
  const vaultRoot = getVaultBasePath(opts.app);
  const absPath = pathMod.join(vaultRoot, vaultRelativePath);

  try {
    const adapter = opts.app.vault.adapter as any;
    const folderPart = (!exportFolder || exportFolder === "/" || exportFolder === ".")
      ? ""
      : exportFolder;
    if (folderPart) {
      try { await adapter.mkdir(folderPart); } catch {}
    }
    await adapter.write(vaultRelativePath, mdContent);
    return absPath;
  } catch (e: any) {
    throw new Error("写入文件失败：" + vaultRelativePath + " - " + e.message);
  }
}
