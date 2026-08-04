// ComposerAttachments: 附件列表管理（纯函数）
// 负责添加/移除/计数/去重等操作

import { ComposerAttachment } from "../types";

/** 添加附件（去重：同 kind + 同 path 视为重复） */
export function addAttachment(
  list: ComposerAttachment[],
  attachment: ComposerAttachment
): ComposerAttachment[] {
  if (list.some((a) => a.kind === attachment.kind && a.path === attachment.path)) {
    return list;
  }
  return [...list, attachment];
}

/** 移除附件（按 id 或 path） */
export function removeAttachment(
  list: ComposerAttachment[],
  idOrPath: string
): ComposerAttachment[] {
  return list.filter((a) => a.id !== idOrPath && a.path !== idOrPath);
}

/** 按 kind 统计数量 */
export function countByKind(list: ComposerAttachment[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const a of list) {
    counts[a.kind] = (counts[a.kind] || 0) + 1;
  }
  return counts;
}

/** 格式化文件大小（人类可读） */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** 获取附件显示名称（用于 UI 标签） */
export function getAttachmentLabel(attachment: ComposerAttachment): string {
  if (attachment.path.includes("/")) {
    return attachment.path.split("/").pop() || attachment.path;
  }
  return attachment.path;
}
