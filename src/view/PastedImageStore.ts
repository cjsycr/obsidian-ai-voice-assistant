// PastedImageStore: 处理粘贴图片的写入/读取/删除
// 图片保存到 vault 配置目录下的插件缓存文件夹
// 使用 Node.js fs API（与 CodexClient 一致）

import { App } from "obsidian";
import { getVaultBasePath } from "../utils/vault";
import * as path from "path";
import { mkdirSync, writeFileSync, unlinkSync } from "fs";

const IMAGE_EXTENSIONS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

export const MAX_IMAGE_SIZE = 10 * 1024 * 1024; // 10 MB
export const MAX_IMAGES_PER_TURN = 3;

/** 获取插件缓存目录（绝对路径） */
function getCacheDir(app: App): string {
  const vaultRoot = getVaultBasePath(app);
  const configDir = (app.vault as any).configDir || ".obsidian";
  return path.join(
    vaultRoot,
    configDir,
    "plugins",
    "ai-whispers",
    "cache",
    "pasted-images"
  );
}

/** 校验图片类型和大小，不符合则抛异常 */
export function validateImage(mimeType: string, sizeBytes: number): void {
  if (!IMAGE_EXTENSIONS[mimeType]) {
    throw new Error(`不支持的图片类型: ${mimeType}（支持 PNG/JPEG/WebP/GIF）`);
  }
  if (sizeBytes > MAX_IMAGE_SIZE) {
    const mb = (sizeBytes / 1024 / 1024).toFixed(1);
    throw new Error(`图片过大 (${mb} MB)，最大 ${MAX_IMAGE_SIZE / 1024 / 1024} MB`);
  }
}

function normalizeTimestamp(ts: string): string {
  return ts.split(":").join("-").split(".").join("-");
}

/** 生成图片缓存路径（不写入） */
export function createImagePath(
  app: App,
  mimeType: string,
  timestamp: string = new Date().toISOString()
): string {
  const ext = IMAGE_EXTENSIONS[mimeType];
  if (!ext) throw new Error(`不支持的图片类型: ${mimeType}`);
  const dir = getCacheDir(app);
  return path.join(dir, `paste-${normalizeTimestamp(timestamp)}.${ext}`);
}

/** 保存剪贴板图片到缓存目录，返回绝对路径 */
export function savePastedImage(
  app: App,
  bytes: Uint8Array,
  mimeType: string,
  timestamp?: string
): string {
  validateImage(mimeType, bytes.byteLength);
  const targetPath = createImagePath(app, mimeType, timestamp);
  mkdirSync(path.dirname(targetPath), { recursive: true });
  writeFileSync(targetPath, bytes);
  return targetPath;
}

/** 删除缓存图片（发送后/移除附件时清理） */
export function deleteCachedImage(filePath: string): void {
  try {
    unlinkSync(filePath);
  } catch (e: any) {
    // ENOENT 表示已不存在，不抛错
    if (e.code !== "ENOENT") throw e;
  }
}

/** 读取图片尺寸（使用 createImageBitmap） */
export async function readImageDimensions(file: Blob): Promise<{ width?: number; height?: number }> {
  try {
    const bitmap = await createImageBitmap(file);
    const dims = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return dims;
  } catch {
    // 无法读取时不阻塞流程
    return {};
  }
}
