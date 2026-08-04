// ChatPanel: 聊天 UI（消息列表 + 输入框 + 工具栏）

import { ChatMessage } from "../types";
import { NoteService } from "../obsidian/NoteService";
import { MarkdownRenderer, Component, TFile, Menu, App, setIcon, Notice } from "obsidian";
import { openMentionPopover, MentionPopoverHandle } from "./MentionPopover";
import { applyTemplateVars, findEmptyVars } from "../utils/templateVars";
import { SearchController } from "./SearchController";
import { ScrollController } from "./ScrollController";
import { renderEmptyState } from "./EmptyState";
import { PluginSettings } from "../types";
import { renderApprovalCard, ApprovalRequest, ReviewDecision } from "./ApprovalModal";
import { ComposerAttachment } from "../types";
import { savePastedImage, deleteCachedImage, readImageDimensions, MAX_IMAGE_SIZE, MAX_IMAGES_PER_TURN } from "./PastedImageStore";
import { addAttachment, removeAttachment, countByKind, formatSize, getAttachmentLabel } from "./ComposerAttachments";


export class ChatPanel {
  private container: HTMLElement;
  private service: NoteService;
  private settings: PluginSettings;
  private getSettings: () => PluginSettings;
  private onOpenThreadsManager: () => void;
  private app: App;
  private messagesEl: HTMLElement | null = null;
  private inputEl: HTMLTextAreaElement | null = null;
  private sendBtn: HTMLButtonElement | null = null;
  private attachBtn: HTMLButtonElement | null = null;
  private policyBtn: HTMLButtonElement | null = null;
  private modelBtn: HTMLButtonElement | null = null;
  private threadsBtn: HTMLButtonElement | null = null;
  private headerEl: HTMLElement | null = null;
  private errorEl: HTMLElement | null = null;
  private statusEl: HTMLElement | null = null;
  private connectionStatusEl: HTMLElement | null = null;
  private toolbarEl: HTMLElement | null = null;
  private renderer = new Component();
  private isSending = false;
  private isGenerating = false;
  private multiSelectMode = false;
  private multiSelectBar: HTMLElement | null = null;
  private selectBtn: HTMLButtonElement | null = null;
  // 新增：快捷指令 & 斜杠 & 智能滚动
  private quickPromptsBar: HTMLElement | null = null;
  private slashBtn: HTMLButtonElement | null = null;
  private mentionHandle: MentionPopoverHandle | null = null;
  private scroll: ScrollController | null = null;
  // 审批请求 → 消息 id 的映射；决策发送回调也一并存在这
  private approvalCallbacks = new Map<string | number, {
    messageId: string;
    onDecide: (d: ReviewDecision) => void;
  }>();
  // 搜索（抽到独立 controller）
  private search: SearchController | null = null;
  private searchBtn: HTMLButtonElement | null = null;
  // 附件（图片粘贴）
  private attachments: ComposerAttachment[] = [];
  private attachmentStripEl: HTMLElement | null = null;
  private attachmentIdCounter = 0;

  constructor(
    container: HTMLElement,
    service: NoteService,
    settings: PluginSettings,
    getSettings: () => PluginSettings,
    onOpenThreadsManager: () => void
  ) {
    this.container = container;
    this.service = service;
    this.app = service.app;
    this.settings = settings;
    this.getSettings = getSettings;
    this.onOpenThreadsManager = onOpenThreadsManager;
  }

  render(): void {
    this.container.empty();
    this.container.addClass("ai-assistant-panel");
    this.headerEl = this.container.createDiv({ cls: "ai-assistant-header" });
    this.statusEl = this.headerEl.createDiv({ cls: "ai-assistant-header-title" });
    this.connectionStatusEl = this.headerEl.createDiv({ cls: "ai-assistant-connection-status" });
    this.updateHeader();
    this.errorEl = this.container.createDiv({ cls: "ai-assistant-error" });
    this.errorEl.style.display = "none";
    // Multi-select 顶部操作栏：放在 header 和 messages 之间（不在滚动区域内）
    this.multiSelectBar = this.container.createDiv({ cls: "ai-assistant-multiselect-bar" });
    this.multiSelectBar.style.display = "none";

    // 消息区外包一层 wrap，方便让滚动按钮停靠在对话框内右下角
    const messagesWrap = this.container.createDiv({ cls: "ai-assistant-messages-wrap" });
    this.messagesEl = messagesWrap.createDiv({ cls: "ai-assistant-messages" });
    this.scroll = new ScrollController(messagesWrap, this.messagesEl);
    this.renderMessages();

    // 搜索控制器（搜索条会插入到 container 中，位于 header 下方）
    this.search = new SearchController(this.container, this.messagesEl, (open) => {
      if (this.searchBtn) this.searchBtn.classList.toggle("is-active", open);
    });

    // Cmd/Ctrl+F 快捷键（面板内）
    this.container.addEventListener("keydown", (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "f") {
        const inPanel = (e.target as HTMLElement)?.closest?.(".ai-assistant-panel");
        if (inPanel) {
          e.preventDefault();
          this.search?.toggle(true);
        }
      }
    });
    this.toolbarEl = this.container.createDiv({ cls: "ai-assistant-toolbar" });
    this.attachBtn = this.toolbarEl.createEl("button", {
      cls: "ai-assistant-toolbar-btn ai-assistant-at-btn",
      attr: { title: "@ 引用笔记（也可在输入框直接输入 @）" },
    });
    this.attachBtn.textContent = "@";
    this.attachBtn.addEventListener("click", () => this.handleAttach());
    // / 斜杠指令（工具条上，@ 旁边）
    this.slashBtn = this.toolbarEl.createEl("button", {
      cls: "ai-assistant-toolbar-btn ai-assistant-slash-btn",
      attr: { title: "斜杠指令（空输入框按 / 也可）" },
    });
    this.slashBtn.textContent = "/";
    this.slashBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      this.showSlashMenu(e);
    });
    this.policyBtn = this.toolbarEl.createEl("button", {
      cls: "ai-assistant-toolbar-btn ai-assistant-toolbar-btn-policy",
      attr: { title: "审批策略" },
    });
    setIcon(this.policyBtn, "shield");
    this.policyBtn.addEventListener("click", (e) => this.showPolicyMenu(e));
    this.modelBtn = this.toolbarEl.createEl("button", {
      cls: "ai-assistant-toolbar-btn ai-assistant-toolbar-btn-model",
      attr: { title: "选择模型" },
    });
    this.modelBtn.addEventListener("click", (e) => this.showModelMenu(e));
    // 打开 Threads 管理器按钮
    this.threadsBtn = this.toolbarEl.createEl("button", {
      cls: "ai-assistant-toolbar-btn",
      attr: { title: "Threads 管理器" },
    });
    setIcon(this.threadsBtn, "layers");
    this.threadsBtn.addEventListener("click", () => {
      if (this.onOpenThreadsManager) this.onOpenThreadsManager();
    });
    // 多选模式按钮
    this.selectBtn = this.toolbarEl.createEl("button", {
      cls: "ai-assistant-toolbar-btn",
      attr: { title: "多选消息" },
    });
    setIcon(this.selectBtn, "check-square");
    this.selectBtn.addEventListener("click", () => this.toggleMultiSelectMode());
    // 搜索按钮
    this.searchBtn = this.toolbarEl.createEl("button", {
      cls: "ai-assistant-toolbar-btn",
      attr: { title: "搜索对话 (Cmd/Ctrl+F)" },
    });
    setIcon(this.searchBtn, "search");
    this.searchBtn.addEventListener("click", () => this.search?.toggle());
    const inputArea = this.container.createDiv({ cls: "ai-assistant-input-area" });

    // 顶部标签条（方案 B）：✨ 询问 AI · ⌃⏎ 发送 · ⏎ 换行
    const topStrip = inputArea.createDiv({ cls: "ai-input-top-strip" });
    const tagEl = topStrip.createDiv({ cls: "ai-input-top-tag" });
    // SAFE: 静态 SVG 常量，无用户输入拼接
    tagEl.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/></svg><span>询问 AI</span>';
    const kbdEl = topStrip.createDiv({ cls: "ai-input-top-kbd" });
    // SAFE: 静态键帽字符串，无用户输入
    kbdEl.innerHTML = '<kbd>⌃</kbd><kbd>⏎</kbd> 发送 <span class="ai-input-top-sep">·</span> <kbd>⏎</kbd> 换行';

    this.inputEl = inputArea.createEl("textarea", {
      attr: { placeholder: "问点什么…", rows: "3" },
    });
    this.inputEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        if (e.metaKey || e.ctrlKey) {
          e.preventDefault();
          this.send();
        }
      }
    });
    // 输入监听：检测「行首 / 空白后」新出现的 @ 或 / —— 弹出对应面板；用户可 Esc 关掉继续输入
    this.inputEl.addEventListener("input", () => this.handleTriggerChars());
    // 粘贴图片
    this.inputEl.addEventListener("paste", (e) => this.handlePaste(e));

    // 附件条（在 textarea 和按钮行之间）
    this.attachmentStripEl = inputArea.createDiv({ cls: "ai-assistant-attachment-strip" });
    this.renderAttachmentStrip();

    // 底部按钮行：左=快捷指令胶囊；右=/ + 发送键（紧贴）
    const btnRow = inputArea.createDiv({ cls: "ai-assistant-btn-row" });

    // 左侧：快捷指令胶囊（横向可滚，占满剩余空间）
    const leftSide = btnRow.createDiv({ cls: "ai-assistant-btn-row-left" });
    this.quickPromptsBar = leftSide.createDiv({ cls: "ai-quick-prompts" });
    this.renderQuickPrompts();

    // 右侧：只保留发送键（/ 已挪到顶部工具条）
    const rightSide = btnRow.createDiv({ cls: "ai-assistant-btn-row-right" });

    this.sendBtn = rightSide.createEl("button", { text: "发送", cls: "ai-assistant-send" });
    setIcon(this.sendBtn, "send");
    this.sendBtn.addEventListener("click", () => {
      if (this.isGenerating) {
        this.stopGeneration();
      } else {
        this.send();
      }
    });
    this.applyFontSize();
    this.updateModelButton();
    this.service.on("messagesUpdated", () => this.renderMessages());
    this.service.on("threadChanged", () => this.updateHeader());
    this.service.on("statusChanged", () => this.updateHeader());
    this.service.on("error", ({ error }) => this.showError(error));

    // 右键"发给AI" -> 填入输入框
    this.service.on("fillInput", ({ text }) => {
      if (this.inputEl) {
        this.inputEl.value = text;
        this.inputEl.focus();
        this.inputEl.scrollTop = this.inputEl.scrollHeight;
      }
    });

    // AI 开始生成 -> 切换为停止按钮
    this.service.on("streamingDelta", () => {
      if (!this.isGenerating) {
        this.isGenerating = true;
        this.updateSendButton();
      }
    });

    // AI 完成 -> 切换回发送按钮
    this.service.on("turnDone", () => {
      this.isGenerating = false;
      this.updateSendButton();
    });
  }

  private updateSendButton(): void {
    if (!this.sendBtn) return;
    if (this.isGenerating) {
      this.sendBtn.empty();
      setIcon(this.sendBtn, "square");
      this.sendBtn.addClass("is-stop");
      this.sendBtn.title = "停止生成";
    } else {
      this.sendBtn.empty();
      setIcon(this.sendBtn, "send");
      this.sendBtn.removeClass("is-stop");
      this.sendBtn.title = "发送";
    }
    this.updateStreamingPill();
  }

  private stopGeneration(): void {
    this.service.stopGeneration();
    this.isGenerating = false;
    this.updateSendButton();
  }

  // ===== Copy toast: 从鼠标位置弹一个青碧短提示 =====
  private showCopyToast(ev: MouseEvent): void {
    const toast = document.body.createDiv({ cls: "ai-copy-toast", text: "✓ 已复制" });
    const x = ev.clientX;
    const y = ev.clientY;
    toast.style.left = (x - 32) + "px";
    toast.style.top = (y - 36) + "px";
    // 触发动画
    requestAnimationFrame(() => toast.classList.add("is-visible"));
    setTimeout(() => {
      toast.classList.remove("is-visible");
      setTimeout(() => toast.remove(), 200);
    }, 1200);
  }

  // ===== 日期分隔线：格式化时间戳为"今天 / 昨天 / M月D日" =====
  private formatDaySeparator(ts: number): string {
    if (!ts) return "";
    const d = new Date(ts);
    const now = new Date();
    const isSameDay = (a: Date, b: Date) =>
      a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    if (isSameDay(d, now)) return "今天";
    if (isSameDay(d, yesterday)) return "昨天";
    const isSameYear = d.getFullYear() === now.getFullYear();
    if (isSameYear) return (d.getMonth() + 1) + "月" + d.getDate() + "日";
    return d.getFullYear() + "年" + (d.getMonth() + 1) + "月" + d.getDate() + "日";
  }

  // ===== Streaming pill：AI 正在打字时，消息区顶部悬浮一个青碧胶囊 =====
  private streamingPillEl: HTMLElement | null = null;
  private updateStreamingPill(): void {
    if (!this.messagesEl) return;
    const wrap = this.messagesEl.parentElement;
    if (!wrap) return;
    const shouldShow = this.isGenerating;
    if (shouldShow && !this.streamingPillEl) {
      this.streamingPillEl = wrap.createDiv({ cls: "ai-streaming-pill" });
      const sparkle = this.streamingPillEl.createSpan({ cls: "ai-streaming-pill-sparkle", text: "✨" });
      void sparkle;
      this.streamingPillEl.createSpan({ cls: "ai-streaming-pill-text", text: "AI 正在回复" });
      const dots = this.streamingPillEl.createSpan({ cls: "ai-streaming-pill-dots" });
      dots.createSpan({ text: "." });
      dots.createSpan({ text: "." });
      dots.createSpan({ text: "." });
    } else if (!shouldShow && this.streamingPillEl) {
      this.streamingPillEl.remove();
      this.streamingPillEl = null;
    }
  }

  applyFontSize(): void {
    const size = this.getSettings().messageFontSize;
    const lineHeight = Math.max(1.2, size * 0.12 + 1).toFixed(2);
    this.container.style.setProperty("--ai-msg-font-size", size + "px");
    this.container.style.setProperty("--ai-msg-line-height", lineHeight);
    this.container.querySelectorAll(".ai-msg-body").forEach((el) => {
      const html = el as HTMLElement;
      html.style.fontSize = size + "px";
      html.style.lineHeight = lineHeight;
    });
    this.container.querySelectorAll(".ai-msg-role").forEach((el) => {
      (el as HTMLElement).style.fontSize = Math.max(9, size - 3) + "px";
    });
  }

  private addCodeBlockButtons(body: HTMLElement): void {
    const codeBlocks = body.querySelectorAll("pre");
    codeBlocks.forEach((pre) => {
      if (pre.querySelector(".ai-code-copy")) return; // already has button
      const btn = (pre as HTMLElement).createEl("button", {
        cls: "ai-code-copy",
        attr: { title: "复制代码", "aria-label": "复制代码" },
      });
      setIcon(btn, "copy");
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const code = pre.querySelector("code");
        const text = code ? code.textContent || "" : pre.textContent || "";
        navigator.clipboard.writeText(text).then(() => {
          setIcon(btn, "check");
          setTimeout(() => setIcon(btn, "copy"), 1500);
        });
      });
    });
  }

  // ===== 快捷指令胶囊（左下角） =====
  refreshQuickPrompts(): void {
    this.renderQuickPrompts();
  }

  private renderQuickPrompts(): void {
    if (!this.quickPromptsBar) return;
    this.quickPromptsBar.empty();
    const prompts = this.getSettings().quickPrompts || [];
    for (const p of prompts) {
      const btn = this.quickPromptsBar.createEl("button", {
        cls: "ai-quick-prompt-btn",
        text: p.name,
        attr: { title: p.prompt.slice(0, 60) + (p.prompt.length > 60 ? "…" : "") },
      });
      // 关键：mousedown 时阻止默认，避免编辑器失焦丢掉 selection（{{selection}} 才能拿到）
      btn.addEventListener("mousedown", (e) => { e.preventDefault(); });
      btn.addEventListener("click", async (e) => {
        e.stopPropagation();
        if (!this.inputEl) return;
        const ctx = { app: this.app, note: this.service.getCurrentNote() };
        const resolved = await applyTemplateVars(p.prompt, ctx);
        // 若使用了变量但取回空值，友好提示
        const empties = await findEmptyVars(p.prompt, ctx);
        if (empties.length > 0) {
          const nameMap: Record<string,string> = {
            "selection": "编辑器选中文本",
            "note-title": "当前笔记标题",
            "note-path": "当前笔记路径",
            "note-content": "当前笔记全文",
            "clipboard": "剪贴板",
          };
          const names = empties.map(k => nameMap[k] || k).join("、");
          new Notice(`⚠️ 未获取到：${names}。请先在编辑器里选中文字（或确认当前有打开笔记）后再点击。`, 4000);
        }
        const cur = this.inputEl.value;
        this.inputEl.value = cur + (cur && !cur.endsWith("\n") ? "\n\n" : "") + resolved;
        this.inputEl.focus();
        this.inputEl.scrollTop = this.inputEl.scrollHeight;
      });
    }
  }

  // ===== 图片粘贴：粘贴事件处理 =====
  private async handlePaste(event: ClipboardEvent): Promise<void> {
    const items = Array.from(event.clipboardData?.items ?? []);
    const imageFiles = items.filter((item) => item.kind === "file" && item.type.startsWith("image/"));
    if (imageFiles.length === 0) return;

    event.preventDefault();

    // 检查数量限制
    const existingCount = (countByKind(this.attachments)["pasted-image"] || 0);
    const remainingSlots = MAX_IMAGES_PER_TURN - existingCount;
    if (remainingSlots <= 0) {
      new Notice(`每轮最多 ${MAX_IMAGES_PER_TURN} 张图片。`, 5000);
      return;
    }

    for (const file of imageFiles.slice(0, remainingSlots)) {
      try {
        const blob = file.getAsFile();
        if (!blob) continue;
        const bytes = new Uint8Array(await blob.arrayBuffer());
        const mimeType = blob.type;
        const dims = await readImageDimensions(blob);

        // 保存到缓存目录
        const savedPath = savePastedImage(this.app, bytes, mimeType);

        const attachment: ComposerAttachment = {
          kind: "pasted-image",
          id: this.createAttachmentId(),
          path: savedPath,
          mimeType,
          sizeBytes: blob.size,
          width: dims.width,
          height: dims.height,
        };
        this.attachments = addAttachment(this.attachments, attachment);
      } catch (e: any) {
        new Notice(`粘贴图片失败: ${e.message}`, 5000);
      }
    }
    this.renderAttachmentStrip();
  }

  /** 生成唯一的附件 ID */
  private createAttachmentId(): string {
    this.attachmentIdCounter += 1;
    return `img-${Date.now()}-${this.attachmentIdCounter}`;
  }

  // ===== 附件条渲染 =====
  private renderAttachmentStrip(): void {
    if (!this.attachmentStripEl) return;
    this.attachmentStripEl.empty();
    if (this.attachments.length === 0) {
      this.attachmentStripEl.style.display = "none";
      return;
    }
    this.attachmentStripEl.style.display = "flex";

    for (const a of this.attachments) {
      const chip = this.attachmentStripEl.createDiv({ cls: "ai-attachment-chip" });
      // 图标
      chip.createSpan({ cls: "ai-attachment-chip-icon", text: "🖼" });
      // 文件名 + 大小
      const label = chip.createSpan({ cls: "ai-attachment-chip-label", text: getAttachmentLabel(a) });
      void label;
      const meta = chip.createSpan({ cls: "ai-attachment-chip-meta", text: formatSize(a.sizeBytes) });
      void meta;
      // 移除按钮
      const removeBtn = chip.createEl("button", {
        cls: "ai-attachment-chip-remove",
        text: "✕",
        attr: { title: "移除附件", "aria-label": "移除附件" },
      });
      const pathToRemove = a.path;
      removeBtn.addEventListener("click", () => {
        this.attachments = removeAttachment(this.attachments, pathToRemove);
        // 清理缓存文件
        deleteCachedImage(pathToRemove);
        this.renderAttachmentStrip();
      });
    }
  }

  private async applySlashCommand(prompt: string): Promise<void> {
    if (!this.inputEl) return;
    if (prompt) {
      const resolved = await applyTemplateVars(prompt, {
        app: this.app,
        note: this.service.getCurrentNote(),
      });
      const cur = this.inputEl.value;
      this.inputEl.value = cur + (cur && !cur.endsWith("\n") ? "\n\n" : "") + resolved;
    }
    this.inputEl.focus();
    this.inputEl.scrollTop = this.inputEl.scrollHeight;
  }

      destroy(): void {
    this.renderer.unload();
    this.approvalCallbacks.clear();
    // 清理附件缓存
    for (const a of this.attachments) {
      if (a.kind === "pasted-image") deleteCachedImage(a.path);
    }
    this.attachments = [];
    this.container.empty();
  }

  /**
   * 侧边栏内嵌审批：把审批作为 role="approval" 消息追加进消息流。
   * 决策后卡片就地折叠成一行 chip，跟消息流一起滚动。
   */
  showApproval(id: string | number, req: ApprovalRequest, onDecide: (d: ReviewDecision) => void): boolean {
    if (!this.messagesEl) return false;
    // 若已有同 id 的（防御性），把旧的先 decline
    const prev = this.approvalCallbacks.get(id);
    if (prev) {
      this.service.resolveApprovalMessage(prev.messageId, "decline");
      this.approvalCallbacks.delete(id);
    }
    const messageId = this.service.addApprovalMessage({
      kind: req.kind,
      command: typeof req.command === "string"
        ? req.command
        : Array.isArray(req.command) ? req.command.join(" ") : undefined,
      cwd: req.cwd,
      reason: req.reason,
      fileChanges: Array.isArray(req.fileChanges)
        ? req.fileChanges.map((x: any) => ({ path: String(x?.path ?? x), type: x?.type }))
        : (req.fileChanges && typeof req.fileChanges === "object"
            ? Object.entries(req.fileChanges).map(([k, v]) => ({ path: k, type: (v as any)?.type }))
            : undefined),
      grantRoot: req.grantRoot,
      requestId: id,
    });
    this.approvalCallbacks.set(id, { messageId, onDecide });
    // 触发滚动到底部（如果用户已在底部）
    try { this.scroll?.followIfAtBottom(); } catch { /* ignore */ }
    return true;
  }

  hasPendingApproval(): boolean {
    for (const _ of this.approvalCallbacks) return true;
    return false;
  }

  /** 渲染一条 role="approval" 的消息 */
  private renderApprovalMessage(msg: ChatMessage): void {
    if (!this.messagesEl) return;
    const a = msg.approval;
    if (!a) return;

    const wrap = this.messagesEl.createDiv({ cls: "ai-msg-row ai-msg-row-approval" });
    if (this.multiSelectMode) wrap.addClass("multi-select-mode");

    if (a.decision) {
      // === 已决策：一行 chip（方案 A） ===
      this.renderApprovalChip(wrap, msg);
    } else {
      // === 未决策：完整活跃卡片 ===
      const rid = a.requestId;
      const cb = rid != null ? this.approvalCallbacks.get(rid) : undefined;
      const req: ApprovalRequest = {
        kind: a.kind,
        command: a.command,
        cwd: a.cwd,
        reason: a.reason,
        fileChanges: a.fileChanges,
        grantRoot: a.grantRoot,
      };
      renderApprovalCard({
        container: wrap,
        req,
        compact: true,
        onDecide: (d) => {
          // 更新消息状态 → 会触发一次 renderMessages → 卡片就地折叠为 chip
          this.service.resolveApprovalMessage(msg.id, d);
          // 把决策发回 Codex
          if (rid != null) {
            const c = this.approvalCallbacks.get(rid);
            this.approvalCallbacks.delete(rid);
            try { c?.onDecide(d); } catch (e) { console.error("[approval] onDecide callback failed", e); }
          }
        },
      });
    }
  }

  /** 已决策的审批 → 一行 chip */
  private renderApprovalChip(wrap: HTMLElement, msg: ChatMessage): void {
    const a = msg.approval!;
    const decision = a.decision!;
    const isOk = decision === "accept" || decision === "acceptForSession";
    const chip = wrap.createDiv({
      cls: "ai-approval-chip" + (isOk ? "" : " decline"),
      attr: { title: this.approvalChipTooltip(a) },
    });
    // 状态图标（小圆）
    const ico = chip.createSpan({ cls: "ai-approval-chip-ico" });
    setIcon(ico, isOk ? "check" : "x");
    // 状态文本
    const statusText = decision === "acceptForSession" ? "本会话都批准"
      : decision === "accept" ? "已批准"
      : decision === "cancel" ? "已中止"
      : "已拒绝";
    chip.createSpan({ cls: "ai-approval-chip-status", text: statusText });
    chip.createSpan({ cls: "ai-approval-chip-sep", text: "·" });
    // 命令预览（截断）
    const preview = a.kind === "exec"
      ? (a.command || "")
      : this.formatFileChangesPreview(a.fileChanges);
    chip.createSpan({ cls: "ai-approval-chip-cmd", text: preview });
    // 展开按钮：点开显示完整目的 + 命令 + 时间
    const expand = chip.createEl("button", {
      cls: "ai-approval-chip-expand",
      text: "⌄",
      attr: { type: "button", "aria-label": "展开详情" },
    });
    // 详情面板（默认隐藏）
    const detail = wrap.createDiv({ cls: "ai-approval-chip-detail" });
    detail.style.display = "none";
    if (a.reason) {
      const r = detail.createDiv({ cls: "ai-approval-chip-detail-row" });
      r.createSpan({ cls: "ai-approval-chip-detail-label", text: "目的：" });
      r.createSpan({ text: a.reason });
    }
    if (a.kind === "exec" && a.command) {
      const c = detail.createDiv({ cls: "ai-approval-chip-detail-cmd" });
      c.textContent = a.command;
    }
    if (a.cwd) {
      detail.createDiv({ cls: "ai-approval-chip-detail-meta", text: "工作目录：" + a.cwd });
    }
    if (a.decidedAt) {
      const t = new Date(a.decidedAt);
      const time = `${t.getHours().toString().padStart(2,'0')}:${t.getMinutes().toString().padStart(2,'0')}:${t.getSeconds().toString().padStart(2,'0')}`;
      detail.createDiv({ cls: "ai-approval-chip-detail-meta", text: "决策于 " + time });
    }
    expand.addEventListener("click", (ev) => {
      ev.stopPropagation();
      const open = detail.style.display === "none";
      detail.style.display = open ? "block" : "none";
      expand.setText(open ? "⌃" : "⌄");
      chip.classList.toggle("is-open", open);
    });
  }

  private approvalChipTooltip(a: NonNullable<ChatMessage["approval"]>): string {
    const parts: string[] = [];
    if (a.reason) parts.push("目的：" + a.reason);
    if (a.kind === "exec" && a.command) parts.push("命令：" + a.command);
    if (a.cwd) parts.push("工作目录：" + a.cwd);
    return parts.join("\n");
  }

  private formatFileChangesPreview(fc?: Array<{ path: string; type?: string }>): string {
    if (!fc || fc.length === 0) return "(patch 审批)";
    if (fc.length === 1) return (fc[0].type ? `[${fc[0].type}] ` : "") + fc[0].path;
    return `${fc.length} 个文件变更 · ${fc[0].path} ...`;
  }

  private updateHeader(): void {
    if (!this.statusEl) return;
    const note = this.service.getCurrentNote();
    const thread = this.service.getCurrentThread();
    const clientReady = this.service.isClientReady();
    const settings = this.getSettings();
    if (!clientReady) {
      this.statusEl.setText("⏳ 等待 Codex 启动…");
    } else if (note && thread) {
      this.statusEl.setText("📓 " + note.path);
      this.statusEl.title = "Thread: " + thread.id;
    } else if (note) {
      this.statusEl.setText("📓 " + note.path + " （加载中…）");
    } else {
      this.statusEl.setText("打开一个 .md 笔记开始");
    }
    if (this.connectionStatusEl) {
      const provider = settings.modelProvider || "全局配置";
      const model = settings.model || "全局配置";
      if (clientReady) {
        this.connectionStatusEl.setText("● " + provider + " · " + model + " · 已连接");
        this.connectionStatusEl.removeClass("is-disconnected");
        this.connectionStatusEl.addClass("is-connected");
      } else {
        this.connectionStatusEl.setText("○ " + provider + " · " + model + " · 未连接");
        this.connectionStatusEl.removeClass("is-connected");
        this.connectionStatusEl.addClass("is-disconnected");
      }
    }
    this.updatePolicyButton();
    this.updateModelButton();
  }

  private updateModelButton(): void {
    if (!this.modelBtn) return;
    const model = this.getSettings().model;
    const displayModel = model || "全局配置";
    this.modelBtn.empty();
    const iconEl = this.modelBtn.createSpan({ cls: "ai-btn-icon" });
    setIcon(iconEl, "chevron-down");
    this.modelBtn.createSpan({ cls: "ai-btn-label", text: displayModel });
    this.modelBtn.title = "当前模型：" + displayModel + "（点击选其他，留空则跟随全局 config.toml）";
  }

  private showModelMenu(event: MouseEvent): void {
    const menu = new Menu();
    const current = this.getSettings().model;
    // 第一项：跟随全局配置
    menu.addItem(item => item
      .setTitle("🌐 跟随全局配置" + (!current ? "  ✓" : ""))
      .onClick(() => {
        this.service.setModel("");
        this.updateModelButton();
      })
    );
    // 固定模型列表
    const models = ["MiniMax-M3", "MiniMax-M2.7", "gpt-4o", "gpt-4o-mini", "gpt-5"];
    models.forEach(m => {
      menu.addItem(item => item
        .setTitle(m + (m === current ? "  ✓" : ""))
        .onClick(() => {
          this.service.setModel(m);
          this.updateModelButton();
        })
      );
    });
    menu.showAtMouseEvent(event);
  }

  private updatePolicyButton(): void {
    if (!this.policyBtn) return;
    const policy = this.service.getApprovalPolicy();
    this.policyBtn.empty();
    const iconEl = this.policyBtn.createSpan({ cls: "ai-btn-icon" });
    setIcon(iconEl, "shield");
    this.policyBtn.createSpan({ cls: "ai-btn-label", text: this.policyShort(policy) });
    this.policyBtn.title = "当前审批策略：" + this.policyLabel(policy) + "（点击切换）";
  }

  private policyShort(p: string): string {
    switch (p) {
      case "never": return "从不";
      case "on-request": return "询问";
      case "granular": return "细粒度";
      case "untrusted": return "严格";
      default: return p;
    }
  }

  private policyLabel(p: string): string {
    switch (p) {
      case "never": return "从不询问（直接执行）";
      case "on-request": return "询问时（推荐）";
      case "granular": return "按类型细分";
      case "untrusted": return "严格（所有操作都问）";
      default: return p;
    }
  }

  private showPolicyMenu(event: MouseEvent): void {
    const menu = new Menu();
    const options: Array<{ v: "on-request" | "never" | "granular" | "untrusted" }> = [
      { v: "on-request" },
      { v: "never" },
      { v: "granular" },
      { v: "untrusted" },
    ];
    const current = this.service.getApprovalPolicy();
    for (const opt of options) {
      menu.addItem(item => item
        .setTitle(this.policyLabel(opt.v) + (opt.v === current ? "  ✓" : ""))
        .onClick(() => {
          this.service.setApprovalPolicy(opt.v);
          this.updatePolicyButton();
        })
      );
    }
    menu.showAtMouseEvent(event);
  }

  // 构建 slash Menu（按 category 分组）
  private buildSlashMenu(): Menu {
    const menu = new Menu();
    const cmds = this.getSettings().slashCommands || [];
    if (cmds.length === 0) {
      menu.addItem(item => item.setTitle("（没有可用的斜杠指令）").setDisabled(true));
      return menu;
    }
    // 按 category 分组，保持原顺序
    const groups = new Map<string, typeof cmds>();
    for (const c of cmds) {
      const cat = c.category || "其他";
      if (!groups.has(cat)) groups.set(cat, [] as any);
      (groups.get(cat) as any).push(c);
    }
    let firstGroup = true;
    for (const [cat, items] of groups) {
      if (!firstGroup) menu.addSeparator();
      firstGroup = false;
      menu.addItem(item => item.setTitle(`— ${cat} —`).setDisabled(true));
      for (const c of items) {
        menu.addItem(item => {
          item.setTitle(c.name);
          if (c.icon) item.setIcon(c.icon);
          item.onClick(() => { void this.applySlashCommand(c.prompt); });
        });
      }
    }
    return menu;
  }

  // / 按钮点击（顶部工具条）：Menu 贴按钮下方弹出
  private showSlashMenu(event: MouseEvent): void {
    this.buildSlashMenu().showAtMouseEvent(event);
  }

  // 键入 / 触发：Menu 贴在 textarea 的下方左侧弹出
  private openSlashMenuAtCaret(): void {
    const menu = this.buildSlashMenu();
    const rect = this.inputEl?.getBoundingClientRect();
    if (rect) {
      menu.showAtPosition({ x: rect.left + 12, y: rect.top - 4 });
    } else {
      menu.showAtPosition({ x: 100, y: 100 });
    }
  }

  // 触发字符处理：input 事件里检测新出现的 @ 或 /；命中时弹面板，用户可继续输入或选择
  private lastTriggerChar: "" | "@" | "/" = "";
  private lastTriggerAtCaret: number = -1;
  private handleTriggerChars(): void {
    if (!this.inputEl) return;
    const val = this.inputEl.value;
    const pos = this.inputEl.selectionStart ?? val.length;
    if (pos <= 0) { this.lastTriggerChar = ""; return; }
    const ch = val.charAt(pos - 1);
    if (ch !== "@" && ch !== "/") { this.lastTriggerChar = ""; return; }
    // 触发条件：@ 或 / 前面是行首、空格、换行（避免 email、URL 中的 @ / / 也触发）
    const prev = pos >= 2 ? val.charAt(pos - 2) : "";
    if (prev !== "" && prev !== " " && prev !== "\n" && prev !== "\t") return;
    // 避免同一次输入重复触发（用户按住 @ 会连续 fire input）
    if (this.lastTriggerChar === ch && this.lastTriggerAtCaret === pos) return;
    this.lastTriggerChar = ch;
    this.lastTriggerAtCaret = pos;
    if (ch === "@") {
      this.openMentionAt(pos - 1);
    } else {
      // 键入 / 触发：先吞掉 /，再弹 Menu（menu 位置贴近 textarea 光标附近）
      this.consumeTriggerChar(pos - 1);
      this.openSlashMenuAtCaret();
    }
  }

  // 从输入框中把某个位置的字符（@ 或 /）吞掉
  private consumeTriggerChar(pos: number): void {
    if (!this.inputEl) return;
    if (pos < 0 || pos >= this.inputEl.value.length) return;
    const v = this.inputEl.value;
    if (v.charAt(pos) !== "@" && v.charAt(pos) !== "/") return;
    this.inputEl.value = v.slice(0, pos) + v.slice(pos + 1);
    // 光标停留在原位置
    try { this.inputEl.setSelectionRange(pos, pos); } catch {}
  }

  /** 工具栏 @ 按钮：在光标处插入 @，然后打开就地补全 */
  private handleAttach(): void {
    if (!this.inputEl) return;
    const inp = this.inputEl;
    const caret = inp.selectionStart ?? inp.value.length;
    // 若光标前不是空白，先补一个空格，避免粘在别的词后面
    const needSpace = caret > 0 && !/[\s\n]/.test(inp.value.charAt(caret - 1));
    const prefix = needSpace ? " @" : "@";
    inp.value = inp.value.slice(0, caret) + prefix + inp.value.slice(caret);
    const newCaret = caret + prefix.length;
    try { inp.setSelectionRange(newCaret, newCaret); } catch {}
    inp.focus();
    // 触发字符位于 newCaret - 1（就是刚插入的 @）
    this.openMentionAt(newCaret - 1);
  }

  /** 输入框中已经有 @ 字符（位置 triggerAt），打开就地补全 popover */
  private openMentionAt(triggerAt: number): void {
    if (!this.inputEl) return;
    // 若已有 popover，先关掉
    this.mentionHandle?.close();
    this.mentionHandle = openMentionPopover({
      app: this.app,
      inputEl: this.inputEl,
      triggerAt,
      onPick: (file) => {
        this.mentionHandle = null;
        if (!this.inputEl) return;
        if (file) {
          // 用 @path.md 替换掉 [triggerAt, caret] 区间（把 @查询词 一起替换）
          const caret = this.inputEl.selectionStart ?? this.inputEl.value.length;
          const insert = "@" + file.path + " ";
          const v = this.inputEl.value;
          this.inputEl.value = v.slice(0, triggerAt) + insert + v.slice(caret);
          const newPos = triggerAt + insert.length;
          try { this.inputEl.setSelectionRange(newPos, newPos); } catch {}
        }
        this.inputEl.focus();
      },
    });
  }

  private renderMessages(): void {
    if (!this.messagesEl) return;
    const messages = this.service.getMessages();
    const note = this.service.getCurrentNote();
    const clientReady = this.service.isClientReady();
    if (!clientReady) {
      this.messagesEl.empty();
      renderEmptyState(this.messagesEl, "connecting");
      return;
    }
    if (!note) {
      this.messagesEl.empty();
      renderEmptyState(this.messagesEl, "no-note");
      return;
    }
    const visibleMessages = messages.filter(m => m.role !== "system");
    if (visibleMessages.length === 0) {
      this.messagesEl.empty();
      renderEmptyState(this.messagesEl, "no-messages");
      return;
    }
    this.messagesEl.empty();
    let lastDayStamp = "";
    for (const msg of visibleMessages) {
      const dayStamp = this.formatDaySeparator(msg.createdAt);
      if (dayStamp && dayStamp !== lastDayStamp) {
        const sep = this.messagesEl.createDiv({ cls: "ai-msg-day-sep" });
        sep.createSpan({ cls: "ai-msg-day-sep-text", text: dayStamp });
        lastDayStamp = dayStamp;
      }
      this.renderMessage(msg);
    }
    // Streaming 顶部 pill：AI 正在打字
    this.updateStreamingPill();
    this.applyFontSize();
    // 智能滚动：只在用户已在底部附近时才跟随
    this.scroll?.followIfAtBottom();
  }

  private renderMessage(msg: ChatMessage): void {
    if (!this.messagesEl) return;
    // === 审批消息：单独走一条路径，跟消息流一起滚动 ===
    if (msg.role === "approval") {
      this.renderApprovalMessage(msg);
      return;
    }
    // === 行容器（透明，flex-row） ===
    const wrap = this.messagesEl.createDiv({ cls: "ai-msg-row ai-msg-row-" + msg.role });
    if (this.multiSelectMode) wrap.addClass("multi-select-mode");

    // === 多选复选框：放在气泡"外面"、role 左侧，天然对齐 ===
    if (this.multiSelectMode) {
      const cb = wrap.createEl("input", {
        type: "checkbox",
        cls: "ai-msg-select-cb",
        attr: { title: "多选" },
      });
      cb.checked = !!msg.selected;
      cb.addEventListener("change", () => {
        this.service.toggleMessageSelection(msg.id);
        this.refreshMultiSelectBar();
      });
    }

    // === 气泡本体（真正装 role + body 的容器） ===
    const bubble = wrap.createDiv({ cls: "ai-msg ai-msg-" + msg.role });
    if (msg.selected) bubble.addClass("is-selected");

    if (msg.role === "assistant" && (msg.reasoning || msg.reasoningStreaming)) {
      const details = bubble.createEl("details", { cls: "ai-msg-reasoning" });
      const summary = details.createEl("summary", { text: msg.reasoningStreaming ? "💭 思考中…" : "💭 思考完毕" });
      const reasoningBody = details.createDiv({ cls: "ai-msg-reasoning-body" });
      reasoningBody.textContent = msg.reasoning || "";
      if (msg.reasoningStreaming) {
        reasoningBody.createSpan({ cls: "ai-msg-cursor", text: "▍" });
      }
      const defaultCollapsed = this.getSettings().reasoningDefaultCollapsed;
      if (!defaultCollapsed) details.setAttribute("open", "");
    }
    const roleEl = bubble.createDiv({ cls: "ai-msg-role" });
    if (msg.role === "assistant") {
      // 内嵌 Lucide sparkles SVG，跟随字体颜色
      // SAFE: 静态 sparkles SVG
      roleEl.innerHTML = '<svg class="ai-msg-role-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5z"/><path d="M18 15l.5 1.5L20 17l-1.5.5L18 19l-.5-1.5L16 17l1.5-.5z"/><path d="M5 4l.5 1.5L7 6l-1.5.5L5 8l-.5-1.5L3 6l1.5-.5z"/></svg><span>AI</span>';
      // 模型名（透明度低，视觉次要）
      const modelName = this.getSettings().model;
      if (modelName) {
        roleEl.createSpan({ cls: "ai-msg-role-model", text: " \u00B7 " + modelName });
      }
    } else {
      roleEl.textContent = "你";
    }
    const body = bubble.createDiv({ cls: "ai-msg-body" });

    // === Actions 工具栏：放在气泡外面（悬浮），hover 才显示 ===
    const actions = wrap.createDiv({ cls: "ai-msg-actions" });
    const mkBtn = (text: string, title: string, onClick: (e: Event) => void) => {
      const b = actions.createEl("button", { cls: "ai-msg-action-btn", attr: { title } });
      b.textContent = text;
      b.addEventListener("click", (e) => { e.stopPropagation(); onClick(e); });
      return b;
    };
    // 复制：所有消息都能复制
    mkBtn("📋", "复制内容", async (ev) => {
      try {
        await navigator.clipboard.writeText(msg.content);
        this.showCopyToast(ev as MouseEvent);
      } catch (e: any) {
        new Notice("复制失败：" + e.message);
      }
    });
    // 翻译（仅 assistant 且有内容）
    if (msg.role === "assistant" && msg.content) {
      mkBtn("🌐", "翻译成中文", () => this.service.translateMessage(msg.id, "中文"));
    }
    // 重新生成（仅 assistant）
    if (msg.role === "assistant" && !msg.streaming) {
      mkBtn("🔄", "重新生成", () => this.service.regenerateMessage(msg.id));
    }
    // 删除
    mkBtn("🗑", "删除", () => {
      if (confirm('确定删除这条消息？')) this.service.deleteMessage(msg.id);
    });

    if (msg.error) {
      body.textContent = "⚠️ " + msg.error;
      body.addClass("ai-msg-error");
    } else if (msg.streaming) {
      if (msg.content) {
        body.textContent = msg.content;
        body.createSpan({ cls: "ai-msg-cursor", text: "▍" });
      } else {
        // 加载动画（三个跳动圆点 + 文字提示，用 Unicode 字符确保可见）
        const loader = body.createDiv({ cls: "ai-msg-loading" });
        loader.createSpan({ cls: "ai-msg-loading-dot", text: "●" });
        loader.createSpan({ cls: "ai-msg-loading-dot", text: "●" });
        loader.createSpan({ cls: "ai-msg-loading-dot", text: "●" });
        loader.createSpan({ cls: "ai-msg-loading-text", text: "思考中…" });
      }
    } else if (msg.content) {
      MarkdownRenderer.renderMarkdown(msg.content, body, "", this.renderer);
      this.addCodeBlockButtons(body);
    } else {
      body.textContent = "（AI 响应为空）";
      body.addClass("ai-msg-empty");
    }
  }

  private async send(): Promise<void> {
    if (this.isSending) return;
    const text = this.inputEl?.value.trim() || "";
    if (!text && this.attachments.length === 0) return;
    this.isSending = true;
    if (this.sendBtn) this.sendBtn.disabled = true;
    this.inputEl!.value = "";
    // 传递附件给 service
    this.service.pendingAttachments = [...this.attachments];
    this.attachments = [];
    this.renderAttachmentStrip();
    try {
      await this.service.send(text);
    } catch (e: any) {
      this.showError(e.message);
    } finally {
      this.isSending = false;
      if (this.sendBtn) this.sendBtn.disabled = false;
      this.inputEl?.focus();
    }
  }

  private showError(msg: string): void {
    if (!this.errorEl) return;
    this.errorEl.setText("⚠️ " + msg);
    this.errorEl.style.display = "block";
    setTimeout(() => { if (this.errorEl) this.errorEl.style.display = "none"; }, 5000);
  }

  // 切换多选模式
  private toggleMultiSelectMode(): void {
    this.multiSelectMode = !this.multiSelectMode;
    if (!this.multiSelectMode) {
      this.service.clearSelection();
    }
    this.refreshMultiSelectBar();
    this.renderMessages();
  }

  // 刷新多选顶部操作栏
  private refreshMultiSelectBar(): void {
    if (!this.multiSelectBar) return;
    const selectedIds = this.service.getSelectedMessageIds();
    const totalVisible = this.service.getMessages().filter(m => m.role !== "system").length;
    const anySelected = selectedIds.length > 0;
    if (!this.multiSelectMode) {
      this.multiSelectBar.style.display = "none";
      this.renderMessages();
      return;
    }
    this.multiSelectBar.style.display = "flex";
    this.multiSelectBar.empty();
    // 全选 checkbox
    const allSelected = selectedIds.length === totalVisible && totalVisible > 0;
    const allCb = this.multiSelectBar.createEl("input", {
      type: "checkbox",
      cls: "ai-assistant-multiselect-all",
    });
    allCb.checked = allSelected;
    allCb.indeterminate = selectedIds.length > 0 && !allSelected;
    allCb.addEventListener('change', () => {
      this.service.selectAllMessages(allCb.checked);
      this.refreshMultiSelectBar();
    });
    this.multiSelectBar.createSpan({ text: " 已选 " + selectedIds.length + " / " + totalVisible, cls: "ai-assistant-multiselect-count" });
    const spacer = this.multiSelectBar.createDiv({ cls: "ai-assistant-multiselect-spacer" });
    spacer.style.flex = "1";
    const exportBtn = this.multiSelectBar.createEl("button", { text: "📦 导出", cls: "ai-assistant-toolbar-btn" });
    exportBtn.addEventListener('click', async () => {
      try {
        const path = await this.service.exportSelectedMessages();
        new Notice("✓ 已导出：" + path);
        this.service.clearSelection();
      } catch (e: any) {
        new Notice("导出失败：" + e.message);
      }
    });
    const delBtn = this.multiSelectBar.createEl("button", { text: "🗑 删除", cls: "ai-assistant-toolbar-btn" });
    delBtn.addEventListener('click', async () => {
      if (!confirm("删除选中的 " + selectedIds.length + " 条消息？")) return;
      await this.service.deleteMessages(selectedIds);
      new Notice("✓ 已删除 " + selectedIds.length + " 条");
    });
    const exitBtn = this.multiSelectBar.createEl("button", { text: "✖ 退出", cls: "ai-assistant-toolbar-btn" });
    exitBtn.addEventListener('click', () => {
      this.service.clearSelection();
      this.multiSelectMode = false;
      this.refreshMultiSelectBar();
    });
  }
}
