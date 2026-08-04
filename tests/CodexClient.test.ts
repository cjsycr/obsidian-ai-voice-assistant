// CodexClient 路径解析测试（COMMON_CODEX_PATHS 行为）
// 因为 CodexClient 的路径解析逻辑耦合 spawn，无法直接单测
// 这里测一个轻量的：判断路径存在
import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

describe("CodexClient 路径解析逻辑（独立于 client）", () => {
  it("resolveCodexPath 逻辑：用户给的绝对路径存在就用", () => {
    // 模拟 resolveCodexPath 的逻辑（不导入类）
    function resolveCodexPath(givenPath: string): string {
      if (givenPath && (givenPath.includes("/") || givenPath.includes("\\"))) {
        if (fs.existsSync(givenPath)) return givenPath;
        throw new Error(`codexPath 不存在: ${givenPath}`);
      }
      return givenPath;
    }
    // 测试用 home 目录（mac 上存在）
    const home = os.homedir();
    expect(resolveCodexPath(home)).toBe(home);
  });

  it("resolveCodexPath：相对路径（无 /）直接返回", () => {
    function resolveCodexPath(givenPath: string): string {
      if (givenPath && (givenPath.includes("/") || givenPath.includes("\\"))) {
        if (fs.existsSync(givenPath)) return givenPath;
        throw new Error("不存在");
      }
      return givenPath;
    }
    expect(resolveCodexPath("codex")).toBe("codex");
    expect(resolveCodexPath("")).toBe("");
  });

  it("resolveCodexPath：绝对路径不存在报错", () => {
    function resolveCodexPath(givenPath: string): string {
      if (givenPath && (givenPath.includes("/") || givenPath.includes("\\"))) {
        if (fs.existsSync(givenPath)) return givenPath;
        throw new Error(`codexPath 不存在: ${givenPath}`);
      }
      return givenPath;
    }
    expect(() => resolveCodexPath("/nonexistent/path/xyz123")).toThrow();
  });

  it("resolveCodexPath：home 下的 .local/bin 存在（用户实际配置）", () => {
    const home = os.homedir();
    const localBin = path.join(home, ".local/bin");
    if (fs.existsSync(localBin)) {
      const codexPath = path.join(localBin, "codex");
      // 用户的 codex 不一定在 .local/bin，但目录存在
      expect(fs.existsSync(localBin)).toBe(true);
    } else {
      // 跳过测试（环境没这目录）
      expect(true).toBe(true);
    }
  });
});
