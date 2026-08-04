// InlineEditModal: 指令输入 + 审查确认 两个 Modal
// 参考 Codexian 的 2 Modal 流程

import { Modal, Notice, App } from "obsidian";
import { InlineEditMode } from "../prompt/inline-edit";

// ============ Modal 1: 指令输入 ============

export class InlineEditInstructionModal extends Modal {
  private mode: InlineEditMode;
  private resolvePromise: ((instruction: string | null) => void) | null = null;
  private settled = false;

  constructor(app: App, mode: InlineEditMode) {
    super(app);
    this.mode = mode;
  }

  /** 打开 Modal 并等待用户输入指令 */
  async waitForInstruction(): Promise<string | null> {
    return new Promise((resolve) => {
      this.resolvePromise = resolve;
      this.open();
    });
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();

    const title = this.mode === "rewrite-selection" ? "改写选中文本" : "在光标处插入";
    this.setTitle(title);

    contentEl.createEl("p", {
      cls: "ai-inline-edit-modal-copy",
      text: this.mode === "rewrite-selection"
        ? "描述你希望如何改写选中文本："
        : "描述你希望插入什么内容：",
    });

    const inputEl = contentEl.createEl("textarea", {
      cls: "ai-inline-edit-textarea",
      attr: { placeholder: "例如：翻译成英文、改得更简洁、补充细节…" },
    });
    inputEl.rows = 4;
    inputEl.style.width = "100%";
    inputEl.style.boxSizing = "border-box";
    setTimeout(() => inputEl.focus(), 0);

    const actionsEl = contentEl.createDiv({ cls: "ai-inline-edit-actions" });
    actionsEl.style.display = "flex";
    actionsEl.style.justifyContent = "flex-end";
    actionsEl.style.gap = "8px";
    actionsEl.style.marginTop = "12px";

    const cancelBtn = actionsEl.createEl("button", { text: "取消" });
    cancelBtn.type = "button";
    cancelBtn.addEventListener("click", () => this.close());

    const submitBtn = actionsEl.createEl("button", {
      cls: "mod-cta",
      text: "生成",
    });
    submitBtn.type = "button";
    submitBtn.addEventListener("click", () => {
      const instruction = inputEl.value.trim();
      if (!instruction) {
        new Notice("指令不能为空。", 4000);
        inputEl.focus();
        return;
      }
      this.settled = true;
      this.resolvePromise?.(instruction);
      this.close();
    });
  }

  onClose(): void {
    this.contentEl.empty();
    if (!this.settled) {
      this.resolvePromise?.(null);
    }
    this.resolvePromise = null;
    this.settled = false;
  }
}

// ============ Modal 2: 审查确认 ============

export interface InlineEditReviewModel {
  title: string;
  originalLabel: string;
  proposedLabel: string;
  applyLabel: string;
  originalText: string;
  proposedText: string;
}

export class InlineEditReviewModal extends Modal {
  private review: InlineEditReviewModel;
  private resolvePromise: ((confirmed: boolean) => void) | null = null;
  private settled = false;

  constructor(app: App, review: InlineEditReviewModel) {
    super(app);
    this.review = review;
  }

  /** 打开 Modal 并等待用户决定 */
  async waitForDecision(): Promise<boolean> {
    return new Promise((resolve) => {
      this.resolvePromise = resolve;
      this.open();
    });
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    this.setTitle(this.review.title);

    const sectionsEl = contentEl.createDiv({ cls: "ai-inline-edit-review" });

    // 原文区
    const originalSection = sectionsEl.createDiv({ cls: "ai-inline-edit-section" });
    originalSection.createEl("h3", {
      cls: "ai-inline-edit-heading",
      text: this.review.originalLabel,
    });
    originalSection.createEl("pre", {
      cls: "ai-inline-edit-pre",
      text: this.review.originalText || "(空)",
    });

    // 改写/插入区
    const proposedSection = sectionsEl.createDiv({ cls: "ai-inline-edit-section" });
    proposedSection.createEl("h3", {
      cls: "ai-inline-edit-heading",
      text: this.review.proposedLabel,
    });
    proposedSection.createEl("pre", {
      cls: "ai-inline-edit-pre is-proposed",
      text: this.review.proposedText || "(空)",
    });

    // 操作按钮
    const actionsEl = contentEl.createDiv({ cls: "ai-inline-edit-actions" });
    actionsEl.style.display = "flex";
    actionsEl.style.justifyContent = "flex-end";
    actionsEl.style.gap = "8px";
    actionsEl.style.marginTop = "12px";

    const cancelBtn = actionsEl.createEl("button", { text: "取消" });
    cancelBtn.type = "button";
    cancelBtn.addEventListener("click", () => this.close());

    const applyBtn = actionsEl.createEl("button", {
      cls: "mod-cta",
      text: this.review.applyLabel,
    });
    applyBtn.type = "button";
    applyBtn.addEventListener("click", () => {
      this.settled = true;
      this.resolvePromise?.(true);
      this.close();
    });
  }

  onClose(): void {
    this.contentEl.empty();
    if (!this.settled) {
      this.resolvePromise?.(false);
    }
    this.resolvePromise = null;
    this.settled = false;
  }
}
