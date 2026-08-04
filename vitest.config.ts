// vitest 配置：基础 + happy-dom + obsidian mock
import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    environment: "happy-dom",
    include: ["tests/**/*.test.ts"],
    globals: false,
    alias: {
      // 把 "obsidian" 指向我们的 mock（Obsidian 是 Electron app 不能直接 import）
      "obsidian": path.resolve(__dirname, "tests/__mocks__/obsidian.ts"),
    },
  },
});
