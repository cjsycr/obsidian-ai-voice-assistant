// 回归测试：isConnected 严格（防止 child 死了但标志是 true）
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";

describe("CodexClient.isConnected 严格（防止 stale state）", () => {
  it("isConnected 必须检查 child !== null", () => {
    const code = readFileSync("src/codex/CodexClient.ts", "utf-8");
    // 找到 isConnected 方法
    const m = code.match(/isConnected\(\)[^}]+\}/);
    expect(m).not.toBeNull();
    if (m) {
      // 必须包含 child !== null 检查
      expect(m[0]).toMatch(/this\.connected.*this\.child|this\.child.*this\.connected/);
    }
  });

  it("不能只用 this.connected（不检查 child）", () => {
    const code = readFileSync("src/codex/CodexClient.ts", "utf-8");
    // 不应该是简单的 { return this.connected; }（无 child 检查）
    expect(code).not.toMatch(/isConnected\(\):\s*boolean\s*\{\s*return\s+this\.connected;\s*\}/);
  });
});
