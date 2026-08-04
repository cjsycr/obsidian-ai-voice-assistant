import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";

// rebuildMessagesFromTurns 已抽到 src/obsidian/ThreadBuilders.ts
const SOURCE = "src/obsidian/ThreadBuilders.ts";

describe("rebuildMessagesFromTurns", () => {
  it("源码不能有 isSys", () => {
    const code = readFileSync(SOURCE, "utf-8");
    expect(code).not.toContain("isSys");
  });
  it("userMessage 应标 role: user", () => {
    const code = readFileSync(SOURCE, "utf-8");
    const start = code.indexOf('item.type === "userMessage"');
    const end = code.indexOf('item.type === "agentMessage"');
    const block = code.substring(start, end);
    expect(block).toMatch(/role:\s*"user"/);
    expect(block).not.toMatch(/role:\s*"system"/);
  });
  it("agentMessage 应标 role: assistant", () => {
    const code = readFileSync(SOURCE, "utf-8");
    const start = code.indexOf('item.type === "agentMessage"');
    const end = code.indexOf("return out");
    const block = code.substring(start, end);
    expect(block).toMatch(/role:\s*"assistant"/);
  });
});
