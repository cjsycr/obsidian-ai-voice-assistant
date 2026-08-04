// 消息区滚动控制器 —— 从 ChatPanel 抽出
// 负责：回顶/回底按钮、智能滚动跟随、自定义进度条（overlay）

import { setIcon } from "obsidian";

export class ScrollController {
  private messagesEl: HTMLElement;
  private toTopBtn: HTMLElement;
  private toBottomBtn: HTMLElement;
  private trackEl: HTMLElement;
  private thumbEl: HTMLElement;
  private fadeTimer: number | null = null;
  private atBottom = true;

  constructor(wrap: HTMLElement, messagesEl: HTMLElement) {
    this.messagesEl = messagesEl;
    // 按钮组
    const btnGroup = wrap.createDiv({ cls: "ai-assistant-scroll-btns" });
    this.toTopBtn = btnGroup.createDiv({ cls: "ai-assistant-scroll-btn", attr: { title: "回到顶部" } });
    setIcon(this.toTopBtn, "chevron-up");
    this.toTopBtn.style.display = "none";
    this.toTopBtn.addEventListener("click", () => this.scrollToTop(true));

    this.toBottomBtn = btnGroup.createDiv({ cls: "ai-assistant-scroll-btn", attr: { title: "回到底部" } });
    setIcon(this.toBottomBtn, "chevron-down");
    this.toBottomBtn.style.display = "none";
    this.toBottomBtn.addEventListener("click", () => this.scrollToBottom(true));

    // 进度条 overlay
    this.trackEl = wrap.createDiv({ cls: "ai-assistant-scroll-track" });
    this.thumbEl = this.trackEl.createDiv({ cls: "ai-assistant-scroll-thumb" });

    // 监听滚动
    this.messagesEl.addEventListener("scroll", () => this.updateTracking());
  }

  /** 消息重渲染后调用一次，同步显隐状态 */
  refresh(): void { this.updateTracking(); }

  /** 消息渲染完成后，如果用户在底部则跟随滚 */
  followIfAtBottom(): void {
    if (this.atBottom) {
      this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
    }
    this.updateTracking();
  }

  isAtBottom(): boolean { return this.atBottom; }

  private updateTracking(): void {
    const el = this.messagesEl;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
    const nearTop = el.scrollTop < 60;
    const scrollable = el.scrollHeight - el.clientHeight > 80;
    this.atBottom = nearBottom;
    this.toBottomBtn.style.display = (scrollable && !nearBottom) ? "flex" : "none";
    this.toTopBtn.style.display = (scrollable && !nearTop) ? "flex" : "none";
    this.updateThumb(scrollable);
  }

  private updateThumb(scrollable: boolean): void {
    if (!scrollable) { this.trackEl.classList.remove("is-visible", "is-scrolling"); return; }
    const trackH = this.trackEl.clientHeight;
    if (trackH <= 0) return;
    const el = this.messagesEl;
    const ratio = el.clientHeight / el.scrollHeight;
    const thumbH = Math.max(28, Math.floor(trackH * ratio));
    const maxScroll = el.scrollHeight - el.clientHeight;
    const pct = maxScroll > 0 ? (el.scrollTop / maxScroll) : 0;
    this.thumbEl.style.height = thumbH + "px";
    this.thumbEl.style.top = Math.floor(pct * (trackH - thumbH)) + "px";
    this.thumbEl.setAttribute("data-pct", Math.round(pct * 100) + "%");
    this.trackEl.classList.add("is-visible", "is-scrolling");
    if (this.fadeTimer) window.clearTimeout(this.fadeTimer);
    this.fadeTimer = window.setTimeout(() => {
      this.trackEl.classList.remove("is-scrolling");
    }, 800);
  }

  scrollToBottom(smooth = true): void {
    this.messagesEl.scrollTo({ top: this.messagesEl.scrollHeight, behavior: smooth ? "smooth" : "auto" });
    this.atBottom = true;
    this.toBottomBtn.style.display = "none";
  }

  scrollToTop(smooth = true): void {
    this.messagesEl.scrollTo({ top: 0, behavior: smooth ? "smooth" : "auto" });
    this.toTopBtn.style.display = "none";
  }
}
