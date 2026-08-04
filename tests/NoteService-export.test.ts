// 测试多选导出逻辑：path 拼接、Markdown 格式
import { describe, it, expect } from "vitest";
import type { ChatMessage } from "../src/types";

describe("导出路径拼接", () => {
  function getExportPath(vaultRoot: string, exportFolder: string, filename: string): string {
    if (exportFolder === "/" || exportFolder === "") {
      return `${vaultRoot}/${filename}`;
    }
    return `${vaultRoot}/${exportFolder}/${filename}`;
  }

  it("默认 exportFolder = 'exports'", () => {
    expect(getExportPath("/Users/x/Vault", "exports", "codex-export-2026-07-15-a.md"))
      .toBe("/Users/x/Vault/exports/codex-export-2026-07-15-a.md");
  });

  it("exportFolder = '/'（vault 根）", () => {
    expect(getExportPath("/Users/x/Vault", "/", "x.md")).toBe("/Users/x/Vault/x.md");
  });

  it("exportFolder = ''（空）也走 vault 根", () => {
    expect(getExportPath("/Users/x/Vault", "", "x.md")).toBe("/Users/x/Vault/x.md");
  });

  it("子目录（带斜杠）", () => {
    expect(getExportPath("/Users/x/Vault", "exports/codex", "x.md"))
      .toBe("/Users/x/Vault/exports/codex/x.md");
  });
});

describe("导出 Markdown 格式", () => {
  function format(messages: ChatMessage[], noteName: string, dateStr: string): string {
    let content = `# 导出对话 - ${noteName}\n\n日期：${dateStr}\n\n---\n\n`;
    for (const m of messages) {
      content += `**${m.role === "user" ? "你" : "AI"}**\n\n`;
      if (m.reasoning) content += `<details><summary>💭 思考过程</summary>\n\n${m.reasoning}\n\n</details>\n\n`;
      content += `${m.content}\n\n---\n\n`;
    }
    return content;
  }

  const mkMsg = (id: string, role: "user" | "assistant", content: string, reasoning?: string): ChatMessage => ({
    id, role, content, createdAt: Date.now(), reasoning,
  });

  it("基本格式：标题 + 日期 + 消息对", () => {
    const msgs: ChatMessage[] = [
      mkMsg("1", "user", "你好"),
      mkMsg("2", "assistant", "你好！"),
    ];
    const out = format(msgs, "test", "2026-07-15");
    expect(out).toContain("# 导出对话 - test");
    expect(out).toContain("日期：2026-07-15");
    expect(out).toContain("**你**\n\n你好");
    expect(out).toContain("**AI**\n\n你好！");
  });

  it("有 reasoning 的消息折叠显示", () => {
    const msgs: ChatMessage[] = [
      mkMsg("1", "user", "Q"),
      mkMsg("2", "assistant", "A", "thinking..."),
    ];
    const out = format(msgs, "t", "2026-07-15");
    expect(out).toContain("<details>");
    expect(out).toContain("<summary>💭 思考过程</summary>");
    expect(out).toContain("thinking...");
  });

  it("无 reasoning 的消息不包含 details 标签", () => {
    const msgs: ChatMessage[] = [
      mkMsg("1", "user", "Q"),
      mkMsg("2", "assistant", "A"),
    ];
    const out = format(msgs, "t", "2026-07-15");
    expect(out).not.toContain("<details>");
  });
});
