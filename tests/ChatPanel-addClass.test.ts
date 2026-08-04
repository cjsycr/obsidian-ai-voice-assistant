// 回归测试：确保 addClass 调用不传空字符串
// 之前 bug：wrap.addClass(this.multiSelectMode ? "x" : "") 当 false 时传 ""
// DOMTokenList 抛 "token provided must not be empty"
import { describe, it, expect } from "vitest";

describe("ChatPanel addClass 调用安全", () => {
  it("不应有 addClass(... ? a : '') 三元传空字符串", async () => {
    const fs = await import("fs");
    const code = fs.readFileSync("src/view/ChatPanel.ts", "utf-8");
    // 不允许这种模式：addClass(condition ? "x" : "")
    // 允许：if (cond) addClass("x")
    // 匹配 addClass(<expr>) 其中 expr 包含条件 ? 模式
    const matches = code.match(/addClass\([^)]*\?[^)]*:[^)]*\)/g) || [];
    const bad = matches.filter(m => m.includes('""') || m.includes("''"));
    expect(bad, "发现 addClass 传空字符串模式").toEqual([]);
  });
});
