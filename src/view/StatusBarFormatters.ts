// StatusBarFormatters: 状态栏格式化工具
// 负责上下文用量估算、模型窗口映射、标签格式化

import { PluginSettings } from "../types";

// 模型上下文窗口（字符数估算）
// 基于 1 token ≈ 4 英文字符 ≈ 2 中文字符 的保守估算
// 这里取 token 数 × 3 作为字符数估算值（偏向中文）
const MODEL_CONTEXT_WINDOWS: Record<string, number> = {
  "MiniMax-M3": 192_000,      // 128K tokens × 1.5
  "MiniMax-M2.7": 192_000,
  "gpt-5": 3_000_000,         // 1M tokens × 3
  "gpt-4o": 384_000,           // 128K tokens × 3
  "gpt-4o-mini": 384_000,
  "o1": 600_000,
  "o3": 600_000,
  "ark-code-latest": 600_000,
};

/** 默认窗口大小（未知模型使用） */
const DEFAULT_WINDOW_CHARS = 192_000;

export interface ContextUsage {
  localChars: number;           // 当前消息列表中的字符数
  estimatedPercentage: number;  // 0-100
  modelWindowChars: number;     // 模型窗口大小
}

/** 获取模型上下文窗口（字符数） */
export function getModelWindowChars(model: string): number {
  return MODEL_CONTEXT_WINDOWS[model] || DEFAULT_WINDOW_CHARS;
}

/** 估算上下文用量 */
export function estimateContextUsage(
  messages: ReadonlyArray<{ role: string; content: string }>,
  model: string
): ContextUsage {
  // 只统计 user 和 assistant 消息
  const totalChars = messages
    .filter(m => m.role === "user" || m.role === "assistant")
    .reduce((sum, m) => sum + (m.content || "").length, 0);

  const modelWindowChars = getModelWindowChars(model);
  const percentage = Math.min(100, Math.round((totalChars / modelWindowChars) * 100));

  return { localChars: totalChars, estimatedPercentage: percentage, modelWindowChars };
}

/** 格式化百分比标签 */
export function formatPercentage(pct: number): string {
  return `${Math.min(100, Math.max(0, pct))}%`;
}

/** 格式化紧凑数字（如 12345 → "12k"） */
export function formatCompact(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

/** 模型选择标签 */
export function getModelLabel(model: string): string {
  return model || "全局";
}

/** 执行状态标签 */
export function formatExecutionState(isRunning: boolean): string {
  return isRunning ? "● 运行中" : "○ 就绪";
}
