// StatusBar: 底部状态栏组件
// 显示上下文用量估算 + 执行状态

import { PluginSettings } from "../types";
import { ContextUsage, estimateContextUsage, formatPercentage, formatCompact, formatExecutionState } from "./StatusBarFormatters";

export interface StatusBarCallbacks {
  /** 获取当前消息列表和模型 */
  getContextInfo: () => { messages: Array<{ role: string; content: string }>; model: string };
  /** 获取当前执行状态 */
}

export class StatusBar {
  private rootEl: HTMLDivElement;
  private meterTrackEl: HTMLSpanElement;
  private meterFillEl: HTMLSpanElement;
  private meterLabelEl: HTMLSpanElement;
  private stateEl: HTMLSpanElement;
  private callbacks: StatusBarCallbacks;
  /** 当前是否正在运行（由事件驱动更新，不依赖回调） */
  private running = false;
  private updateTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    statusBarEl: HTMLElement,
    callbacks: StatusBarCallbacks
  ) {
    this.callbacks = callbacks;

    this.rootEl = statusBarEl.createDiv({ cls: "ai-statusbar" });

    // 上下文用量进度条
    const meterGroup = this.rootEl.createDiv({ cls: "ai-statusbar-meter-group" });
    this.meterLabelEl = meterGroup.createSpan({ cls: "ai-statusbar-meter-label", text: "…" });
    this.meterTrackEl = meterGroup.createSpan({ cls: "ai-statusbar-meter-track" });
    this.meterFillEl = meterGroup.createSpan({ cls: "ai-statusbar-meter-fill" });
    this.meterTrackEl.appendChild(this.meterFillEl);

    // 执行状态
    this.stateEl = this.rootEl.createSpan({ cls: "ai-statusbar-state", text: "○ 就绪" });

    // 初始更新
    this.refresh();

    // 每 2 秒自动刷新
    this.updateTimer = setInterval(() => this.refresh(), 2000);
  }

  /** 手动刷新上下文用量和执行状态 */
  refresh(): void {
    const { messages, model } = this.callbacks.getContextInfo();

    // 更新上下文用量
    const usage = estimateContextUsage(messages, model);
    this.updateMeter(usage);

    // 更新执行状态
    this.stateEl.textContent = formatExecutionState(this.running);
    this.stateEl.style.color = isRunning
      ? "var(--text-accent, #4ade80)"
      : "var(--text-muted)";
  }

  private updateMeter(usage: ContextUsage): void {
    const pct = usage.estimatedPercentage;
    this.meterLabelEl.textContent = `Est. ${formatPercentage(pct)}`;
    this.meterFillEl.style.width = `${pct}%`;

    // 颜色渐近：绿色 < 50% → 黄色 < 80% → 红色 ≥ 80%
    let color: string;
    if (pct >= 80) color = "var(--text-error, #f87171)";
    else if (pct >= 50) color = "var(--text-warning, #fbbf24)";
    else color = "var(--text-success, #4ade80)";
    this.meterFillEl.style.background = color;

    // Tooltip：详细说明
    const tooltip = [
      `上下文用量估算: ${formatCompact(usage.localChars)} / ${formatCompact(usage.modelWindowChars)} 字符`,
      `模型窗口: ${formatCompact(usage.modelWindowChars)} 字符`,
      "",
      "⚠ 这是基于本地消息字符数的估算值",
      "并非 Codex 的精确 token 计数",
    ].join("\n");
    this.rootEl.title = tooltip;
  }

  destroy(): void {
    if (this.updateTimer) {
      clearInterval(this.updateTimer);
      this.updateTimer = null;
    }
    this.rootEl.remove();
  }
}
