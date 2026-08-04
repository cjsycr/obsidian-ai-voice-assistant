// Vault 工具：统一管理 vault 根路径获取（消除 main.ts 和 NoteService 重复）

import type { App } from "obsidian";

/**
 * 拿 vault 根的绝对路径（用于 minimax cwd、context 注入等）
 * duck typing：检查 adapter.getBasePath 是否为函数（不检查 instanceof，兼容 mock）
 */
export function getVaultBasePath(app: App): string {
  const adapter = (app as any)?.vault?.adapter;
  if (adapter && typeof adapter.getBasePath === "function") {
    return adapter.getBasePath();
  }
  return "";
}
