// 测试 inline-edit prompt 构建和回复解析
import { describe, it, expect } from "vitest";
import {
  extractInlineEditResponse,
  buildInlineEditReview,
  getInlineEditSystemPrompt,
  buildInlineEditPrompt,
} from "../src/prompt/inline-edit";

describe("InlineEdit", () => {
  describe("extractInlineEditResponse", () => {
    it("解析 <replacement> 标签", () => {
      const result = extractInlineEditResponse("<replacement>这是改写后的文本</replacement>");
      expect(result.kind).toBe("replacement");
      expect(result.text).toBe("这是改写后的文本");
    });

    it("解析 <insertion> 标签", () => {
      const result = extractInlineEditResponse("<insertion>这是插入的文本</insertion>");
      expect(result.kind).toBe("insertion");
      expect(result.text).toBe("这是插入的文本");
    });

    it("解析 <clarification> 标签", () => {
      const result = extractInlineEditResponse("<clarification>请指定目标语言？</clarification>");
      expect(result.kind).toBe("clarification");
      expect(result.text).toBe("请指定目标语言？");
    });

    it("fallback 解析单代码块", () => {
      const result = extractInlineEditResponse("```markdown\n这是代码块内容\n```");
      expect(result.kind).toBe("raw");
      expect(result.text).toBe("这是代码块内容");
    });

    it("无标签时返回 raw 类型", () => {
      const result = extractInlineEditResponse("纯文本回复");
      expect(result.kind).toBe("raw");
      expect(result.text).toBe("纯文本回复");
    });

    it("处理空字符串", () => {
      const result = extractInlineEditResponse("");
      expect(result.kind).toBe("raw");
      expect(result.text).toBe("");
    });
  });

  describe("buildInlineEditReview", () => {
    it("改写模式构建正确的 label", () => {
      const review = buildInlineEditReview({
        mode: "rewrite-selection",
        originalText: "原文",
        proposedText: "改写后",
      });
      expect(review.title).toBe("审查改写结果");
      expect(review.originalLabel).toBe("当前选中");
      expect(review.proposedLabel).toBe("改写方案");
      expect(review.applyLabel).toBe("替换选中");
    });

    it("插入模式构建正确的 label", () => {
      const review = buildInlineEditReview({
        mode: "insert-at-cursor",
        originalText: "",
        proposedText: "新内容",
      });
      expect(review.title).toBe("审查插入内容");
      expect(review.originalLabel).toBe("光标上下文");
      expect(review.proposedLabel).toBe("待插入文本");
      expect(review.applyLabel).toBe("插入文本");
    });
  });

  describe("getInlineEditSystemPrompt", () => {
    it("包含核心规则", () => {
      const prompt = getInlineEditSystemPrompt();
      expect(prompt).toContain("核心规则");
      expect(prompt).toContain("匹配风格");
      expect(prompt).toContain("只输出结果");
      expect(prompt).toContain("<replacement>");
      expect(prompt).toContain("<insertion>");
      expect(prompt).toContain("<clarification>");
    });
  });

  describe("buildInlineEditPrompt", () => {
    it("构建非空 prompt", () => {
      const prompt = buildInlineEditPrompt({
        mode: "rewrite-selection",
        instruction: "翻译成英文",
        documentText: "这是一段关于机器学习的笔记。",
        rangeStart: 0,
        rangeEnd: 10,
      });
      expect(prompt).toContain("翻译成英文");
      expect(prompt).toContain("改写选中文本");
    });

    it("插入模式构建正确的 prompt", () => {
      const prompt = buildInlineEditPrompt({
        mode: "insert-at-cursor",
        instruction: "补充一段结论",
        documentText: "开头\n\n结尾",
        rangeStart: 5,
        rangeEnd: 5,
      });
      expect(prompt).toContain("补充一段结论");
      expect(prompt).toContain("在光标处生成文本插入");
    });
  });
});
