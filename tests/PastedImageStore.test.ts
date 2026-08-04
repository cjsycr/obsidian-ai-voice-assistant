// 测试 PastedImageStore 的图片校验逻辑
// 纯函数测试，不依赖 Obsidian API
import { describe, it, expect } from "vitest";
import { validateImage, MAX_IMAGE_SIZE, MAX_IMAGES_PER_TURN } from "../src/view/PastedImageStore";

describe("PastedImageStore", () => {
  describe("validateImage", () => {
    it("接受合法的 PNG 图片", () => {
      expect(() => validateImage("image/png", 1024)).not.toThrow();
    });

    it("接受合法的 JPEG 图片", () => {
      expect(() => validateImage("image/jpeg", 1024)).not.toThrow();
    });

    it("接受合法的 WebP 图片", () => {
      expect(() => validateImage("image/webp", 1024)).not.toThrow();
    });

    it("接受合法的 GIF 图片", () => {
      expect(() => validateImage("image/gif", 1024)).not.toThrow();
    });

    it("拒绝不支持的图片类型", () => {
      expect(() => validateImage("image/bmp", 1024)).toThrow("不支持");
      expect(() => validateImage("image/svg+xml", 1024)).toThrow("不支持");
      expect(() => validateImage("application/pdf", 1024)).toThrow("不支持");
    });

    it("拒绝超过大小限制的图片", () => {
      const oversized = MAX_IMAGE_SIZE + 1;
      expect(() => validateImage("image/png", oversized)).toThrow("过大");
    });

    it("接受刚好等于大小限制的图片", () => {
      expect(() => validateImage("image/png", MAX_IMAGE_SIZE)).not.toThrow();
    });
  });

  describe("constants", () => {
    it("MAX_IMAGES_PER_TURN 为 3", () => {
      expect(MAX_IMAGES_PER_TURN).toBe(3);
    });

    it("MAX_IMAGE_SIZE 为 10MB", () => {
      expect(MAX_IMAGE_SIZE).toBe(10 * 1024 * 1024);
    });
  });
});
