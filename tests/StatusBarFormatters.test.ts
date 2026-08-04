// 测试 StatusBarFormatters 的纯函数
import { describe, it, expect } from "vitest";
import {
  estimateContextUsage,
  formatPercentage,
  formatCompact,
  formatExecutionState,
  getModelLabel,
  getModelWindowChars,
} from "../src/view/StatusBarFormatters";

describe("StatusBarFormatters", () => {
  describe("estimateContextUsage", () => {
    it("空消息列表返回 0%", () => {
      const result = estimateContextUsage([], "gpt-4o");
      expect(result.localChars).toBe(0);
      expect(result.estimatedPercentage).toBe(0);
    });

    it("只统计 user 和 assistant 消息", () => {
      const messages = [
        { role: "user", content: "hello" },
        { role: "assistant", content: "world" },
        { role: "system", content: "system prompt" },
      ];
      const result = estimateContextUsage(messages, "gpt-4o");
      expect(result.localChars).toBe(10); // "hello" + "world" = 10
    });

    it("百分比不超过 100", () => {
      const messages = [
        { role: "user", content: "x".repeat(500_000) },
      ];
      const result = estimateContextUsage(messages, "gpt-4o");
      expect(result.estimatedPercentage).toBeLessThanOrEqual(100);
    });

    it("未知模型使用默认窗口", () => {
      const messages = [{ role: "user", content: "test" }];
      const result = estimateContextUsage(messages, "unknown-model-xyz");
      expect(result.modelWindowChars).toBe(192_000);
    });
  });

  describe("formatPercentage", () => {
    it("正常值", () => {
      expect(formatPercentage(50)).toBe("50%");
    });

    it("限制在 0-100 范围", () => {
      expect(formatPercentage(-10)).toBe("0%");
      expect(formatPercentage(150)).toBe("100%");
    });
  });

  describe("formatCompact", () => {
    it("小于 1000 不缩写", () => {
      expect(formatCompact(999)).toBe("999");
    });

    it("千位缩写", () => {
      expect(formatCompact(1234)).toBe("1.2k");
      expect(formatCompact(10000)).toBe("10k");
    });

    it("百万缩写", () => {
      expect(formatCompact(1_234_567)).toBe("1.2M");
    });
  });

  describe("formatExecutionState", () => {
    it("运行中", () => {
      expect(formatExecutionState(true)).toBe("● 运行中");
    });

    it("就绪", () => {
      expect(formatExecutionState(false)).toBe("○ 就绪");
    });
  });

  describe("getModelWindowChars", () => {
    it("已知模型返回正确值", () => {
      expect(getModelWindowChars("gpt-4o")).toBe(384_000);
      expect(getModelWindowChars("MiniMax-M3")).toBe(192_000);
    });

    it("未知模型返回默认值", () => {
      expect(getModelWindowChars("unknown")).toBe(192_000);
    });
  });

  describe("getModelLabel", () => {
    it("返回模型名", () => {
      expect(getModelLabel("gpt-4o")).toBe("gpt-4o");
    });

    it("空字符串返回全局", () => {
      expect(getModelLabel("")).toBe("全局");
    });
  });
});
