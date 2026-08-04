// Obsidian 插件主入口

import { App, Plugin, WorkspaceLeaf, Notice } from "obsidian";
import { CodexClient } from "./codex/CodexClient";
import { ActiveNoteTracker } from "./obsidian/ActiveNoteTracker";
import { ThreadRegistry } from "./obsidian/ThreadRegistry";
import { NoteService } from "./obsidian/NoteService";
import { AssistantView, VIEW_TYPE_ASSISTANT } from "./view/AssistantView";
import { CodexThreadsView, VIEW_TYPE_CODEX_THREADS } from "./view/CodexThreadsView";
import { getVaultBasePath } from "./utils/vault";
// (import 是模块顶层，已在文件头)
import { AIVoiceSettingTab } from "./settings/SettingTab";
import { PluginSettings, DEFAULT_SETTINGS } from "./types";
import { openTour } from "./view/Tour";
import { StatusBar } from "./view/StatusBar";
import { runInlineEdit } from "./view/InlineEditController";
import { InlineEditMode } from "./prompt/inline-edit";
import { CodexApprovalModal, ReviewDecision, ApprovalRequest } from "./view/ApprovalModal";

export default class AIVoiceAssistantPlugin extends Plugin {
  settings: PluginSettings = DEFAULT_SETTINGS;
  client: CodexClient | null = null;
  tracker: ActiveNoteTracker | null = null;
  registry: ThreadRegistry | null = null;
  service: NoteService | null = null;
  private viewReady = false;
  private statusBarComponent: StatusBar | null = null;
  /** 状态栏事件监听器引用（用于移除时精确清理） */
  private statusBarListeners: Array<{ event: string; handler: () => void }> = [];

  async onload(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    // 确保新字段有默认值
    if (typeof this.settings.messageFontSize !== "number") this.settings.messageFontSize = 13;
    if (typeof this.settings.reasoningDefaultCollapsed !== "boolean") this.settings.reasoningDefaultCollapsed = true;
    if (typeof this.settings.showStatusBar !== "boolean") this.settings.showStatusBar = true;

    // 迁移：清除旧的硬编码 model/modelProvider，让它们跟随全局 config.toml
    // （CC-Switch 等工具会修改 config.toml，插件不应覆盖）
    let needsSave = false;
    if (this.settings.model === "MiniMax-M3" || this.settings.model === "minimax-m1") {
      this.settings.model = "";
      needsSave = true;
    }
    if (this.settings.modelProvider === "minimax") {
      this.settings.modelProvider = "";
      needsSave = true;
    }

    // 迁移: Codex app-server 已把 approvalPolicy 的 'on-failure' 变体移除,
    // 替换为 'granular'。老 data.json 里存的任何非白名单值（如 'on-failure'）
    // 会让 thread/start 报 InvalidRequest。这里统一兜底为 'on-request'。
    {
      const VALID = new Set(["never", "on-request", "granular", "untrusted"]);
      const cur = this.settings.approvalPolicy as any;
      if (!VALID.has(cur)) {
        console.log(`[settings] migrated approvalPolicy: ${JSON.stringify(cur)} → on-request`);
        this.settings.approvalPolicy = "on-request";
        needsSave = true;
      }
    }

    this.settings.vaultRoot = this.app.vault.getRoot().path;
    if (needsSave) {
      // 保存迁移后的设置（异步，不阻塞加载）
      this.saveAll().catch(() => {});
    }

    // 不再用 status bar（避免和 view 重叠）

    this.addRibbonIcon("bot", "打开 AI 助手", () => this.activateView());

    // 先注册 view（不等 codex 启动）
    this.registerView(VIEW_TYPE_ASSISTANT, (leaf) => {
      if (!this.service) throw new Error("service not initialized");
      return new AssistantView(leaf, this.service, this.settings, () => this.settings, () => this.activateCodexThreads());
    });

    this.registerView(VIEW_TYPE_CODEX_THREADS, (leaf) => {
      if (!this.service) throw new Error("service not initialized");
      return new CodexThreadsView(leaf, this.service, () => this.getThreadMap(), getVaultBasePath(this.app));
    });

    this.addSettingTab(new AIVoiceSettingTab(this.app, this));

    // 立即创建 service + tracker（service 启动后会等 client.start）
    this.tracker = new ActiveNoteTracker(this.app);
    this.registry = new ThreadRegistry(this);
    await this.registry.load();
    // 先建一个临时 client 占位（不连接），等下再替换
    const vaultRoot0 = getVaultBasePath(this.app);
    this.client = new CodexClient(this.settings.codexPath, vaultRoot0);
    this.service = new NoteService(this.app, this.client, this.tracker, this.registry, this.settings);
    this.tracker.start();
    this.service.start();
    this.service.on("error", ({ error }: { error: string }) => new Notice(`AI 助手错误：${error}`));

    // 状态栏
    // 状态栏（可选，可在设置中关闭）
    if (this.settings.showStatusBar) {
      this.initStatusBar();
    }

    // 审批请求：弹窗让用户决策 → 回 JSON-RPC response 给 Codex
    this.service.on("approvalRequest", (req: any) => this.handleApprovalRequest(req));

    this.client.on("disconnected", (reason?: string) => {
      this.updateStatusBar(`🔌 断开${reason ? '：' + reason : ''}`);
      new Notice("AI 助手：Codex 断开连接，请重载插件");
    });

    // 启动 codex（后台，不阻塞 view 显示）
    this.startCodexAsync();

    // view 准备好
    this.viewReady = true;
    this.updateStatusBar("🤖 AI 助手：未连接");
    this.app.workspace.onLayoutReady(() => {
      this.activateView();
      this.maybeShowTour();
    });

    // Codex Threads 管理器命令
    this.addCommand({
      id: "open-codex-threads",
      name: "Codex: Open Threads Manager",
      callback: () => this.activateCodexThreads(),
    });

    // 选中文本右键菜单：发给 AI 助手
    this.registerEvent(
      this.app.workspace.on("editor-menu", (menu, editor) => {
        const selection = editor.getSelection();
        if (selection && selection.trim()) {
          menu.addItem((item) => {
            item.setTitle("发给 AI 助手")
              .setIcon("bot")
              .onClick(() => {
                this.service?.fillInput(selection);
                this.activateView();
              });
          });
        }

        // 分隔线
        menu.addSeparator();

        // Inline Edit：改写选中文本
        if (selection && selection.trim()) {
          menu.addItem((item) => {
            item.setTitle('AI 改写选中文本')
              .setIcon('pencil')
              .onClick(() => {
                if (this.client) runInlineEdit(this.app, this.client, 'rewrite-selection', this.service);
              });
          });
        }

        // Inline Edit：在光标处插入（始终可用）
        menu.addItem((item) => {
          item.setTitle('AI 在光标处插入文本')
            .setIcon('plus')
            .onClick(() => {
              if (this.client) runInlineEdit(this.app, this.client, 'insert-at-cursor', this.service);
            });
        });
      })
    );

    // 快捷键：聚焦 AI 输入框
    this.addCommand({
      id: "focus-ai-input",
      name: "AI: 聚焦输入框",
      callback: async () => {
        await this.activateView();
        // 稍等一下再触发 focus（等 view 渲染完成）
        setTimeout(() => {
          const ta = document.querySelector<HTMLTextAreaElement>(".ai-assistant-panel textarea");
          if (ta) { ta.focus(); ta.scrollTop = ta.scrollHeight; }
        }, 80);
      },
    });

    // 内联编辑：改写选中文本
    this.addCommand({
      id: "inline-edit-selection",
      name: "AI: 改写选中文本（Inline Edit）",
      callback: () => {
                if (this.client) runInlineEdit(this.app, this.client, 'rewrite-selection', this.service);
      },
    });

    // 内联编辑：光标处插入
    this.addCommand({
      id: "inline-insert-at-cursor",
      name: "AI: 在光标处插入（Inline Edit）",
      callback: () => {
                if (this.client) runInlineEdit(this.app, this.client, 'insert-at-cursor', this.service);
      },
    });

    // 兜底：迁移旧数据缺少的字段
    if (!Array.isArray(this.settings.quickPrompts) || this.settings.quickPrompts.length === 0) {
      this.settings.quickPrompts = DEFAULT_SETTINGS.quickPrompts;
    }
    if (!Array.isArray(this.settings.slashCommands) || this.settings.slashCommands.length === 0) {
      this.settings.slashCommands = DEFAULT_SETTINGS.slashCommands;
    }
  }

  async onunload(): Promise<void> {
    this.statusBarComponent?.destroy();
    this.statusBarComponent = null;
    await this.client?.stop();
  }



  // 异步启动 codex，不抛到外层
  private startCodexAsync(): void {
    this.updateStatusBar("🤖 启动 Codex…");
    Promise.race([
      this.client!.start(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Codex 启动超时（10s）")), 10000)
      ),
    ]).then(() => {
      this.updateStatusBar("🤖 AI 助手：已连接");
      // 重连后：刷新当前笔记的 thread
      if (this.service?.getCurrentNote()) {
        this.service["switchToNote"](this.service.getCurrentNote()!);
      }
    }).catch((e: any) => {
      this.updateStatusBar("❌ Codex 启动失败");
      const help = "无法启动 Codex：" + e.message + "\n\n" +
        "💡 解决方法：\n" +
        "1. 打开 设置 → AI 助手(Codex)\n" +
        "2. 把「Codex CLI 路径」改成绝对路径：\n" +
        "   /Applications/ChatGPT.app/Contents/Resources/codex\n" +
        "3. 点「重启 Codex」";
      new Notice(help, 15000);
      console.error("[AI Assistant] codex start failed", e);
    });
  }

  /** 首次启动时如果 tourCompleted=false，弹出引导 */
  private maybeShowTour(): void {
    if (this.settings.tourCompleted) return;
    setTimeout(() => this.startTour(), 700);
  }

  /** 手动播放引导（供设置面板调用） */
  startTour(): void {
    openTour({
      onFinish: async () => {
        this.settings.tourCompleted = true;
        await this.saveData(this.settings);
      },
    });
  }

  /** 刷新所有打开的 AI 助手面板中的快捷指令栏（设置变化时调用） */
  refreshChatPanel(): void {
    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_ASSISTANT);
    for (const leaf of leaves) {
      const view = leaf.view as any;
      if (view && view.panel && typeof view.panel.refreshQuickPrompts === "function") {
        view.panel.refreshQuickPrompts();
      }
    }
  }

  // 统一保存：merge settings + threadMap（避免互相覆盖）
  async saveAll(): Promise<void> {
    const cur = ((await this.loadData()) || {}) as any;
    const threadMap = (this.registry as any)?.map || {};
    await this.saveData({
      ...cur,
      ...this.settings,
      threadMap,
    });
  }

  async restartCodex(): Promise<void> {
    await this.client?.stop();
    const vaultRoot1 = getVaultBasePath(this.app);
    this.client = new CodexClient(this.settings.codexPath, vaultRoot1);
    if (this.service) {
      this.service["client"] = this.client;
      this.client.on("disconnected", (reason?: string) => {
        this.updateStatusBar(`🔌 断开${reason ? '：' + reason : ''}`);
        new Notice("AI 助手：Codex 断开连接，请重载插件");
      });
    }
    this.startCodexAsync();
  }

  isViewReady(): boolean { return this.viewReady; }
  isCodexConnected(): boolean { return this.client?.isConnected() ?? false; }
  getCodexError(): string | null {
    if (this.client?.isConnected()) return null;
    return "Codex 未连接";
  }

  // 刷新所有 view（设置变化时用）
  refreshAllViews(): void {
    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_ASSISTANT);
    for (const leaf of leaves) {
      if (leaf.view instanceof AssistantView) {
        const view = leaf.view as AssistantView;
        // 重新应用字体大小
        // 实际 ChatPanel 内部用 CSS var，CSS var 在 view 渲染时已应用
        // 这里可以触发 re-render
      }
    }
  }

  getThreadMap(): Record<string, string> {
    return (this.registry as any)?.map || {};
  }

  async activateCodexThreads(): Promise<void> {
    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_CODEX_THREADS);
    let leaf: WorkspaceLeaf | null = (leaves[0] as WorkspaceLeaf | undefined) || null;
    if (!leaf) {
      leaf = this.app.workspace.getRightLeaf(false);
      if (!leaf) return;
      await leaf.setViewState({ type: VIEW_TYPE_CODEX_THREADS, active: true });
    }
    this.app.workspace.revealLeaf(leaf);
  }

  async activateView(): Promise<void> {
    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_ASSISTANT);
    let leaf: WorkspaceLeaf | null = (leaves[0] as WorkspaceLeaf | undefined) || null;
    if (!leaf) {
      const right = this.app.workspace.getRightLeaf(false);
      if (!right) return;
      leaf = right;
      await leaf.setViewState({ type: VIEW_TYPE_ASSISTANT, active: true });
    }
    this.app.workspace.revealLeaf(leaf);
  }


  /** 根据设置创建或销毁状态栏 */
  /** 根据设置创建或销毁状态栏 */
  toggleStatusBar(enabled: boolean): void {
    if (enabled && !this.statusBarComponent) {
      this.initStatusBar();
    } else if (!enabled && this.statusBarComponent) {
      this.statusBarComponent.destroy();
      this.statusBarComponent = null;
      // 移除事件监听器，避免泄漏
      for (const { event, handler } of this.statusBarListeners) {
        this.service?.off(event as any, handler);
      }
      this.statusBarListeners = [];
    }
  }


  /** 初始化状态栏 */
  /** 初始化状态栏 */
  private initStatusBar(): void {
    try {
      const statusBarEl = this.addStatusBarItem();
      this.statusBarComponent = new StatusBar(statusBarEl, {
        getContextInfo: () => ({
          messages: this.service?.getMessages() || [],
          model: this.settings.model || "全局",
        }),
      });

      // 注册事件监听器，保存引用供后续移除
      const onMessagesUpdated = () => this.statusBarComponent?.refresh();
      const onTurnDone = () => {
        this.statusBarComponent?.refresh();
        this.statusBarComponent?.setRunning(false);
      };
      const onStatusChanged = () => this.statusBarComponent?.refresh();
      const onStreamingDelta = () => this.statusBarComponent?.setRunning(true);
      this.service?.on("messagesUpdated", onMessagesUpdated);
      this.service?.on("turnDone", onTurnDone);
      this.service?.on("statusChanged", onStatusChanged);
      this.service?.on("streamingDelta", onStreamingDelta);
      this.statusBarListeners = [
        { event: "messagesUpdated", handler: onMessagesUpdated },
        { event: "turnDone", handler: onTurnDone },
        { event: "statusChanged", handler: onStatusChanged },
        { event: "streamingDelta", handler: onStreamingDelta },
      ];
    } catch (e) {
      console.warn("[AI Assistant] status bar init failed:", e);
    }

  }

  /** 根据设置创建或销毁状态栏 */
  private updateStatusBar(text: string): void {
    // no-op (status bar 已移除，连接状态在 view header 显示)
  }

  private handleApprovalRequest(req: any): void {
    if (!this.client) return;
    const method = String(req?.method || "");
    const params = req?.params || {};
    let payload: ApprovalRequest;
    // method 名在不同 Codex 版本略有差异，这里用宽松匹配：
    // - exec:  execCommandApproval / applyExecApproval / execApprovalRequest / ...
    //         也用 params 里出现 `command` 字段作为兜底
    // - patch: applyPatchApproval / patchApprovalRequest / ...
    //         用 params.file_changes / params.fileChanges 兜底
    const looksLikeExec = /exec/i.test(method) || Array.isArray(params.command);
    const looksLikePatch = /patch/i.test(method) || !!(params.file_changes || params.fileChanges);
    if (looksLikeExec && !looksLikePatch) {
      payload = {
        kind: "exec",
        callId: params.callId,
        command: params.command,
        cwd: params.cwd,
        reason: params.reason,
      };
    } else if (looksLikePatch) {
      payload = {
        kind: "patch",
        callId: params.callId,
        fileChanges: params.file_changes || params.fileChanges,
        reason: params.reason,
        grantRoot: params.grant_root || params.grantRoot,
      };
    } else {
      // 未知 server request：默认 decline，避免 turn 卡死
      console.warn("[approval] unknown server request method:", method, params);
      try { this.client.sendResponse(req.id, { decision: "decline" }); } catch { /* ignore */ }
      return;
    }
    // 决策发送（同一 request 只发一次）
    let sent = false;
    const send = (decision: ReviewDecision) => {
      if (sent) return;
      sent = true;
      console.log("[approval] user decided:", decision);
      try { this.client?.sendResponse(req.id, { decision }); }
      catch (e) { console.error("[approval] send response failed", e); }
    };

    // 优先侧边栏内嵌；拿不到就 fallback Modal
    this.tryShowApprovalInSidebar(req.id, payload, send).then((ok) => {
      if (ok) {
        console.log("[approval] rendered in sidebar for", method);
        return;
      }
      console.log("[approval] fallback to Modal for", method);
      const modal = new CodexApprovalModal(this.app, payload, send);
      modal.open();
    });
  }

  /**
   * 尝试在 AssistantView 侧边栏内嵌审批卡片。
   * 若视图未打开，主动 activateView，最多等 300ms；仍拿不到就返回 false 让上层用 Modal 兜底。
   */
  private async tryShowApprovalInSidebar(
    id: string | number,
    payload: ApprovalRequest,
    onDecide: (d: ReviewDecision) => void
  ): Promise<boolean> {
    const findPanel = (): { panel: any } | null => {
      const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_ASSISTANT);
      for (const leaf of leaves) {
        const view = leaf.view;
        if (view instanceof AssistantView && (view as AssistantView).panel) {
          return { panel: (view as AssistantView).panel };
        }
      }
      return null;
    };

    let found = findPanel();
    if (!found) {
      // 视图没打开：主动激活，然后轮询等它就绪
      try { await this.activateView(); } catch { /* ignore */ }
      const start = Date.now();
      while (Date.now() - start < 300) {
        await new Promise(r => setTimeout(r, 30));
        found = findPanel();
        if (found) break;
      }
    }
    if (!found || !found.panel) return false;
    try {
      return !!found.panel.showApproval(id, payload, onDecide);
    } catch (e) {
      console.error("[approval] sidebar render failed:", e);
      return false;
    }
  }
}
