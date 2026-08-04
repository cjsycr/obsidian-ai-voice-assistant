// NoteService: 整合 CodexClient + ActiveNoteTracker + ThreadRegistry
// 业务逻辑核心：笔记变化时自动 resume/create thread，发 turn 时注入笔记上下文

import { App, TFile } from "obsidian";
import { EventEmitter } from "events";
import { CodexClient } from "../codex/CodexClient";
import { getVaultBasePath } from "../utils/vault";
import { ActiveNoteTracker, ActiveNoteEvent } from "./ActiveNoteTracker";
import { ThreadRegistry } from "./ThreadRegistry";
import { ChatMessage, PluginSettings, CodexThread, Turn, ComposerAttachment } from "../types";
import { exportSelectedMessages as _exportSelectedMessages } from "./Export";
import { buildContext as _buildContext, stripSystemContext as _stripSystemContext } from "./ContextBuilder";
import { buildBaseInstructions, rebuildMessagesFromTurns as _rebuildMessagesFromTurns } from "./ThreadBuilders";

// Codex app-server 认可的 approvalPolicy 枚举白名单。
// 任何超出这份列表的值（例如老版本残留的 'on-failure'）在发到 Codex 前会被兜底成 'on-request'。
const VALID_APPROVAL_POLICIES = new Set(["never", "on-request", "granular", "untrusted"]);
function sanitizeApprovalPolicy(p: unknown): "never" | "on-request" | "granular" | "untrusted" {
  if (typeof p === "string" && VALID_APPROVAL_POLICIES.has(p)) return p as any;
  if (p !== undefined) {
    console.warn(`[AI Assistant] 非法 approvalPolicy=${JSON.stringify(p)}，已兜底为 'on-request'`);
  }
  return "on-request";
}

export type NoteServiceEvent =
  | { type: "threadChanged"; note: TFile | null; thread: CodexThread | null }
  | { type: "messagesUpdated"; threadId: string; messages: ChatMessage[] }
  | { type: "streamingDelta"; threadId: string; itemId: string; delta: string }
  | { type: "error"; error: string }
  | { type: "statusChanged"; clientReady: boolean };

// 事件系统：静态映射事件名 -> payload 类型，避免下游 as any
export interface ServiceEventMap {
  messagesUpdated: { threadId: string; messages: any[] };
  streamingDelta: { threadId: string; itemId: string; delta: string };
  turnDone: { threadId: string; turn: any };
  threadChanged: { note: any; thread: any };
  statusChanged: { clientReady: boolean };
  error: { error: string };
  fillInput: { text: string };
}

export class NoteService extends EventEmitter {
  // 类型化事件签名（覆盖 EventEmitter 的宽松 string 签名）
  on<K extends keyof ServiceEventMap>(event: K, listener: (payload: ServiceEventMap[K]) => void): this;
  on(event: string, listener: (...args: any[]) => void): this;
  on(event: any, listener: any): this { return super.on(event, listener); }
  emit<K extends keyof ServiceEventMap>(event: K, payload: ServiceEventMap[K]): boolean;
  emit(event: string, ...args: any[]): boolean;
  emit(event: any, ...args: any[]): boolean { return super.emit(event, ...args); }

  public app: App;
  public client: CodexClient;
  private tracker: ActiveNoteTracker;
  private registry: ThreadRegistry;
  private settings: PluginSettings;
  private currentThread: CodexThread | null = null;
  private currentNote: TFile | null = null;
  private messages: ChatMessage[] = [];
  private pendingNoteSwitch: TFile | null = null;
  private currentTurnId: string | null = null;
  /** 本轮待发送的附件（图片粘贴等），由 ChatPanel 在调用 send() 前设置 */
  pendingAttachments: ComposerAttachment[] = [];
  // === approval 消息的本地存档（跨 thread 切换持久化） ===
  // 只存本 vault、本插件维度；用 sessionStorage 即可（本次 obsidian 启动内有效）
  // key: threadId → approval ChatMessage[]（按时间序）
  private approvalArchive: Map<string, ChatMessage[]> = new Map();

  /** 从后往前找最后一条"流式中的 assistant 消息"。审批消息插入后仍能正确定位。 */
  private findLastStreamingAssistant(): ChatMessage | undefined {
    for (let i = this.messages.length - 1; i >= 0; i--) {
      const m = this.messages[i];
      if (m.role === "assistant" && m.streaming) return m;
    }
    return undefined;
  }
  /** 从后往前找最后一条 assistant（不要求 streaming）；用于 reasoningCompleted 等场景 */
  private findLastAssistant(): ChatMessage | undefined {
    for (let i = this.messages.length - 1; i >= 0; i--) {
      const m = this.messages[i];
      if (m.role === "assistant") return m;
    }
    return undefined;
  }

  constructor(
    app: App, client: CodexClient, tracker: ActiveNoteTracker,
    registry: ThreadRegistry, settings: PluginSettings,
  ) {
    super();
    this.app = app;
    this.client = client;
    this.tracker = tracker;
    this.registry = registry;
    this.settings = settings;
  }

  start(): void {
    this.tracker.on("change", (ev) => this.onNoteChange(ev as ActiveNoteEvent));

    this.client.on("agentMessageDelta", (p) => {
      // 从后往前找最后一条 streaming assistant（审批消息插入后 last 可能是 approval，
      // 不能再用 messages[length-1] 一刀切）
      const last = this.findLastStreamingAssistant();
      if (last) {
        if (!last.itemId) last.itemId = p.itemId;
        if (!last.turnId) last.turnId = p.turnId;
        last.content += p.delta;
        this.emit("streamingDelta", { threadId: p.threadId, itemId: p.itemId, delta: p.delta });
        this.emit("messagesUpdated", { threadId: p.threadId, messages: this.messages });
      }
    });

    this.client.on("turnCompleted", (p) => {
      const last = this.findLastStreamingAssistant();
      if (last) {
        last.streaming = false;
        // 从 turn.items 提取 reasoning（如果流式时没收到）
        if (!last.reasoning && p.turn?.items) {
          for (const item of p.turn.items) {
            if (item.type === "reasoning") {
              last.reasoning = (item as any).summary || (item as any).text || "";
              break;
            }
          }
        }
        // 从 turn.items 提取最终文本（如果流式 delta 没收到）
        if (!last.content && p.turn?.items) {
          for (const item of p.turn.items) {
            if (item.type === "agentMessage") {
              last.content = (item as any).text || "";
              last.itemId = item.id;
              break;
            }
          }
        }
        this.emit("messagesUpdated", { threadId: p.threadId, messages: this.messages });
      }
      this.currentTurnId = null;
      this.emit("turnDone", { threadId: p.threadId, turn: p.turn });
    });

    this.client.on("turnFailed", (p) => {
      console.error("[AI Assistant] turnFailed", JSON.stringify(p, null, 2));
    });

    // 监听所有 item 事件
    this.client.on("notification", (n) => {
      if (n.method?.startsWith("item/")) {
      }
    });

    // 监听 error 通知：只记日志，不弹给用户
    // （真正的错误由 turnFailed 和 switchToNote 的 catch 块处理）
    this.client.on("notification", (n) => {
      if (n.method === "error") {
        const err = n.params && n.params.error;
        const msg = (err && err.message) || "未知错误";
        console.warn("[AI Assistant] codex error notification (suppressed):", msg);
      }
    });

    // 监听 Codex server → client 的审批请求
    this.client.on("serverRequest", (req: any) => {
      this.emit("approvalRequest", req);
    });

    // turn 开始的第一时间就锁定 currentTurnId，
    // 让审批消息（往往发生在 turn 开始后不久）能拿到正确的锚点
    this.client.on("turnStarted", (p: any) => {
      // 兼容两种形态：{ turnId } / { turn: { id } }
      const tid = p?.turnId || p?.turn?.id;
      if (tid) this.currentTurnId = tid;
    });

    // 监听 reasoning 增量（思考过程实时显示）
    this.client.on("reasoningDelta", (p) => {
      console.debug("[AI Assistant] reasoningDelta received:", p.itemId, "len=", (p.delta || "").length);
      const last = this.findLastStreamingAssistant();
      if (last) {
        if (!last.reasoningItemId) last.reasoningItemId = p.itemId;
        last.reasoning = (last.reasoning || "") + p.delta;
        last.reasoningStreaming = true;
        this.emit("messagesUpdated", { threadId: p.threadId, messages: this.messages });
      }
    });
    // summaryTextDelta: 部分模型（如 ark-code-latest）用 summary 而非 full text
    this.client.on("reasoningSummaryDelta", (p) => {
      const last = this.findLastStreamingAssistant();
      if (last) {
        if (!last.reasoningItemId) last.reasoningItemId = p.itemId;
        last.reasoning = (last.reasoning || "") + p.delta;
        last.reasoningStreaming = true;
        this.emit("messagesUpdated", { threadId: p.threadId, messages: this.messages });
      }
    });
    this.client.on("reasoningCompleted", (p) => {
      const last = this.findLastAssistant();
      if (last) {
        last.reasoningStreaming = false;
        this.emit("messagesUpdated", { threadId: p.threadId, messages: this.messages });
      }
    });

    // 监听 delta
    this.client.on("agentMessageDelta", (p) => {
    });

    // turnFailed 时把错误显示给用户
    this.client.on("turnFailed", (p) => {
      const err = p.turn && p.turn.error;
      if (err) {
        const last = this.findLastAssistant();
        if (last) {
          last.error = err.message || "AI 响应失败";
          last.streaming = false;
          this.emit("messagesUpdated", { threadId: p.threadId, messages: this.messages });
        }
      }
    });

    this.client.on("turnFailed", (p) => {
      const last = this.findLastStreamingAssistant();
      if (last) {
        last.streaming = false;
        last.error = "AI 响应失败";
        this.emit("messagesUpdated", { threadId: p.threadId, messages: this.messages });
      }
    });

    this.client.on("ready", () => {
      this.emit("statusChanged", { clientReady: true });
      if (this.pendingNoteSwitch) {
        const note = this.pendingNoteSwitch;
        this.pendingNoteSwitch = null;
        this.switchToNote(note);
      }
    });

    this.client.on("disconnected", () => {
      this.emit("statusChanged", { clientReady: false });
    });

    // active-leaf-change 已由 ActiveNoteTracker -> onNoteChange -> switchToNote 处理
    // 不再重复监听（避免两次 threadResume 竞争导致报错）

    if (this.client.isConnected()) {
      const cur = this.tracker.getCurrent();
      if (cur) this.switchToNote(cur);
    } else {
      this.pendingNoteSwitch = this.tracker.getCurrent();
    }
  }

  private async onNoteChange(ev: ActiveNoteEvent): Promise<void> {
    if (ev.type === "opened") {
      if (!this.client.isConnected()) {
        this.pendingNoteSwitch = ev.note;
        return;
      }
      await this.switchToNote(ev.note);
    } else if (ev.type === "renamed") {
      const oldId = this.registry.get(ev.oldPath);
      if (oldId) {
        await this.registry.delete(ev.oldPath);
        await this.registry.set(ev.note.path, oldId);
      }
      if (this.currentNote?.path === ev.oldPath) this.currentNote = ev.note;
    } else if (ev.type === "deleted") {
      const tid = this.registry.get(ev.note.path);
      if (tid) {
        try { await this.client.threadArchive(tid); } catch {}
        await this.registry.delete(ev.note.path);
      }
      if (this.currentNote?.path === ev.note.path) {
        this.currentNote = null;
        this.currentThread = null;
        this.messages = [];
        this.emit("threadChanged", { note: null, thread: null });
      }
    }
  }

  async switchToNote(note: TFile): Promise<void> {
    if (!this.client.isConnected()) {
      this.pendingNoteSwitch = note;
      return;
    }
    this.currentNote = note;
    this.messages = [];
    this.emit("messagesUpdated", { threadId: "", messages: this.messages });

    const notePath = note.path;
    let threadId = this.registry.get(notePath);

    if (threadId) {
      try {
        const res = await this.client.threadResume({ threadId });
        this.currentThread = res.thread;
        this.messages = await _rebuildMessagesFromTurns(this.client, res.thread);
        this.mergeApprovalArchive(res.thread.id);
        this.emit("threadChanged", { note, thread: res.thread });
        this.emit("messagesUpdated", { threadId, messages: this.messages });
        return;
      } catch (e: any) {
        // threadResume 失败是正常的（thread 过期/配置变更），不弹错误
        console.warn("[AI Assistant] threadResume failed, will create new:", e.message);
        await this.registry.delete(notePath);
        threadId = undefined;
      }
    }

    // cwd 已是 vaultRoot
    const cwd = getVaultBasePath(this.app);

    // 构建 baseInstructions（thread 级别系统提示）
    const baseInstructions = buildBaseInstructions(this.settings);

    const startParams: any = {
      cwd,
      threadSource: this.settings.threadSource,
      approvalPolicy: sanitizeApprovalPolicy(this.settings.approvalPolicy),
      baseInstructions,
    };
    // 只有用户明确设置了 model/modelProvider 才传（否则跟随 config.toml）
    if (this.settings.model) startParams.model = this.settings.model;
    if (this.settings.modelProvider) startParams.modelProvider = this.settings.modelProvider;

    try {
      const res = await this.client.threadStart(startParams);
      this.currentThread = res.thread;
      await this.registry.set(notePath, res.thread.id);
      this.emit("threadChanged", { note, thread: res.thread });
      this.emit("messagesUpdated", { threadId: res.thread.id, messages: this.messages });

      // ★ 用 thread/name/set API 给 thread 设名字（桌面版 list 显示）
      try {
        const threadName = this.settings.threadNamePrefix + notePath;
        await this.client.threadSetName(res.thread.id, threadName);
        this.currentThread.name = threadName;
        this.emit("threadChanged", { note, thread: this.currentThread });
      } catch (e: any) {
        console.warn("[AI Assistant] threadSetName failed:", e.message);
      }
    } catch (e: any) {
      console.warn("[AI Assistant] threadStart failed:", e.message);
      this.emit("error", { error: `创建 thread 失败: ${e.message}` });
    }
  }

  async send(userText: string): Promise<void> {
    if (!this.client.isConnected()) {
      this.emit("error", { error: "Codex 未连接" });
      return;
    }
    if (!this.currentThread) {
      this.emit("error", { error: "当前没有打开的笔记" });
      return;
    }
    if (!userText.trim()) return;

    const userMsg: ChatMessage = {
      id: `u-${Date.now()}`,
      role: "user",
      content: userText,
      createdAt: Date.now(),
    };
    this.messages.push(userMsg);

    const assistantMsg: ChatMessage = {
      id: `a-${Date.now()}`,
      role: "assistant",
      content: "",
      streaming: true,
      createdAt: Date.now(),
    };
    this.messages.push(assistantMsg);
    this.emit("messagesUpdated", { threadId: this.currentThread.id, messages: this.messages });

    const context = await this.buildContext(userText);
    const input = [{ type: "text", text: context }];

    try {
      const res = await this.client.turnStart({
        threadId: this.currentThread.id,
        input: input as any,
        cwd: this.currentThread.cwd,
        ...(this.settings.model ? { model: this.settings.model } : {}),
        ...(this.settings.modelProvider ? { modelProvider: this.settings.modelProvider } : {}),
        approvalPolicy: sanitizeApprovalPolicy(this.settings.approvalPolicy),
      });
      const firstItem = res.turn?.items?.[0];
      if (firstItem) {
        assistantMsg.itemId = firstItem.id;
        assistantMsg.turnId = res.turn.id;
      }
      this.currentTurnId = res.turn.id;
      this.pendingAttachments = [];
    } catch (e: any) {
      assistantMsg.streaming = false;
      assistantMsg.error = e.message;
      this.emit("messagesUpdated", { threadId: this.currentThread.id, messages: this.messages });
    }
  }

  async stopGeneration(): Promise<void> {
    if (!this.currentThread || !this.currentTurnId) return;
    try {
      await this.client.turnInterrupt(this.currentThread.id, this.currentTurnId);
    } catch (e) {
      console.warn("[AI Assistant] turnInterrupt failed:", e);
    }
    const last = this.findLastStreamingAssistant();
    if (last) {
      last.streaming = false;
      if (!last.content) last.content = "（已停止生成）";
      this.emit("messagesUpdated", { threadId: this.currentThread.id, messages: this.messages });
    }
    this.currentTurnId = null;
    this.emit("turnDone", { threadId: this.currentThread?.id || "", turn: null });
  }

  fillInput(text: string): void {
    this.emit("fillInput", { text } as any);
  }

  private async buildContext(userText: string): Promise<string> {
    return _buildContext(userText, {
      app: this.app,
      currentNote: this.currentNote,
      settings: this.settings,
      attachments: this.pendingAttachments,
    });
  }

  /** 剥离 buildContext 加上的系统包装，只返回用户实际输入 */
  private stripSystemContext(raw: string): string {
    return _stripSystemContext(raw);
  }

  // === 列出所有 thread（管理用）===
  // minimax 的 Thread 对象没有 archived 字段，需要分别拉两次
  async listAllThreads(includeArchived: boolean = false): Promise<Array<{ t: any, isArchived: boolean }>> {
    try {
      // 1. 拉非归档
      const r1 = await this.client.threadList({ limit: 100, archived: false });
      const active = (r1.data || []).map(t => ({ t, isArchived: false }));
      if (!includeArchived) return active;
      // 2. 拉归档
      const r2 = await this.client.threadList({ limit: 100, archived: true });
      const archived = (r2.data || []).map(t => ({ t, isArchived: true }));
      // 合并：活跃 + 归档
      return [...active, ...archived];
    } catch (e) {
      console.error("[AI Assistant] listAllThreads failed:", e);
      return [];
    }
  }

  async archiveThread(threadId: string): Promise<void> {
    await this.client.threadArchive(threadId);
  }

  // 激活一个 thread（归档 → 设为当前活跃）
  // - unarchive thread（minimax 端）
  // - 如果 thread 在 threadMap（plugin 之前记录过），找对应 note 并打开
  // - 否则调 threadResume 设为 currentThread（AI 继续之前的对话）
  async setActiveThreadById(threadId: string): Promise<void> {
    // 1. unarchive（如果 archived）
    try {
      await this.client.threadUnarchive(threadId);
    } catch (e) {
      // 可能没归档，忽略
    }

    // 2. 找关联笔记（如果有）
    const notePath = this.registry.reverseLookup(threadId);
    if (notePath) {
      const file = this.app.vault.getAbstractFileByPath(notePath);
      if (file && file instanceof TFile) {
        try {
          // 用 openLinkText 更稳（如果笔记已打开，激活它；否则在新 tab 打开）
          await this.app.workspace.openLinkText(file.path, "", false);
          return;
        } catch (e) {
          console.error("[AI Assistant] openLinkText failed:", e);
        }
      }
    }

    // 3. 没关联笔记：直接设为 currentThread（AI 继续之前的对话）
    try {
      const r = await this.client.threadResume({ threadId });
      this.currentThread = r.thread;
      // 加载历史消息
      this.messages = await _rebuildMessagesFromTurns(this.client, r.thread);
      this.mergeApprovalArchive(r.thread.id);
      this.emit("threadChanged", { note: this.currentNote, thread: r.thread });
      this.emit("messagesUpdated", { threadId, messages: this.messages });
    } catch (e: any) {
      console.error("[AI Assistant] setActiveThreadById failed:", e);
      throw e;
    }
  }


  // === 消息操作（前端 toolbar 调用）===

  // 单条删除
  async deleteMessage(messageId: string): Promise<void> {
    const idx = this.messages.findIndex(m => m.id === messageId);
    if (idx === -1) return;
    this.messages.splice(idx, 1);
    if (this.currentThread) {
      this.emit("messagesUpdated", { threadId: this.currentThread.id, messages: this.messages });
    }
  }

  // 批量删除（多选）
  async deleteMessages(messageIds: string[]): Promise<void> {
    const set = new Set(messageIds);
    this.messages = this.messages.filter(m => !set.has(m.id));
    if (this.currentThread) {
      this.emit("messagesUpdated", { threadId: this.currentThread.id, messages: this.messages });
    }
  }

  // 切换单条多选
  async toggleMessageSelection(messageId: string): Promise<void> {
    const msg = this.messages.find(m => m.id === messageId);
    if (!msg) return;
    (msg as any).selected = !(msg as any).selected;
    if (this.currentThread) {
      this.emit("messagesUpdated", { threadId: this.currentThread.id, messages: this.messages });
    }
  }

  // === 审批消息：作为 role="approval" 的 ChatMessage 挂进消息流 ===
  /** 追加一条 pending 审批消息，返回其 UI id */
  addApprovalMessage(payload: {
    kind: "exec" | "patch";
    command?: string;
    cwd?: string;
    reason?: string;
    fileChanges?: Array<{ path: string; type?: string }>;
    grantRoot?: string;
    requestId?: string | number;
  }): string {
    const id = `approval-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    // 主锚点：当前 turnId（rebuild 前后稳定）
    const anchorTurnId = this.currentTurnId || undefined;
    // 兜底锚点：最近一条有 itemId 的 user/assistant 消息
    let anchorItemId: string | undefined;
    for (let i = this.messages.length - 1; i >= 0; i--) {
      const m = this.messages[i];
      if ((m.role === "assistant" || m.role === "user") && m.itemId) {
        anchorItemId = m.itemId;
        break;
      }
    }
    const msg: ChatMessage = {
      id,
      role: "approval",
      content: "",
      createdAt: Date.now(),
      turnId: anchorTurnId,
      approval: {
        kind: payload.kind,
        command: payload.command,
        cwd: payload.cwd,
        reason: payload.reason,
        fileChanges: payload.fileChanges,
        grantRoot: payload.grantRoot,
        requestId: payload.requestId,
        anchorTurnId,
        anchorItemId,
        // decision 尚未做出
      },
    };
    this.messages.push(msg);
    this.appendToApprovalArchive(msg);
    if (this.currentThread) {
      this.emit("messagesUpdated", { threadId: this.currentThread.id, messages: this.messages });
    }
    return id;
  }

  /** 用户决策后：把 decision 写回对应消息，触发一次重渲染 → 卡片就地折叠 */
  resolveApprovalMessage(id: string, decision: "accept" | "acceptForSession" | "decline" | "cancel"): void {
    const msg = this.messages.find(m => m.id === id);
    if (!msg || !msg.approval) return;
    if (msg.approval.decision) return; // 已决策，忽略重入
    msg.approval.decision = decision;
    msg.approval.decidedAt = Date.now();
    this.updateApprovalArchive(msg);
    if (this.currentThread) {
      this.emit("messagesUpdated", { threadId: this.currentThread.id, messages: this.messages });
    }
  }

  /** 追加一条到本地存档（sessionStorage-like，内存 map；plugin 重载后清空） */
  private appendToApprovalArchive(msg: ChatMessage): void {
    if (!this.currentThread) return;
    const tid = this.currentThread.id;
    if (!this.approvalArchive.has(tid)) this.approvalArchive.set(tid, []);
    // 存副本，避免后续被外部改动串了
    this.approvalArchive.get(tid)!.push({ ...msg, approval: { ...(msg.approval as any) } });
  }
  private updateApprovalArchive(msg: ChatMessage): void {
    if (!this.currentThread || !msg.approval) return;
    const tid = this.currentThread.id;
    const arr = this.approvalArchive.get(tid);
    if (!arr) return;
    const idx = arr.findIndex(m => m.id === msg.id);
    if (idx < 0) return;
    arr[idx] = { ...msg, approval: { ...(msg.approval as any) } };
  }
  /** 从存档把 approval 消息按 createdAt 时间序合并回 this.messages */
  private mergeApprovalArchive(threadId: string): void {
    const arr = this.approvalArchive.get(threadId);
    if (!arr || arr.length === 0) return;
    // 已在消息里的 approval id 跳过（防御性）
    const existing = new Set(this.messages.filter(m => m.role === "approval").map(m => m.id));

    // 按锚点 itemId 把 approval 插入到对应消息之后
    // 一次 archive 里可能多条 approval 挂同一个锚点（同一次 AI 回复中批准了多次命令），
    // 需要保持 archive 内的原始顺序（即 push 时的顺序）。
    // 策略：从 archive 尾部往前反向遍历，每条都插到"锚点 itemId 消息的位置 + 1"，
    // 反向可以让相同锚点的多条 approval 保持稳定顺序。
    let mergedCount = 0;
    for (let i = arr.length - 1; i >= 0; i--) {
      const a = arr[i];
      if (existing.has(a.id)) continue;
      const clone: ChatMessage = { ...a, approval: { ...(a.approval as any) } };
      // pending 卡片 → decline 兜底（Codex request 已失效）
      if (clone.approval && !clone.approval.decision) {
        clone.approval.decision = "decline";
        clone.approval.decidedAt = Date.now();
      }
      // 找锚点位置：优先 turnId（找该 turn 最后一条消息，插到它之后），
      // 否则 fallback 到 anchorItemId（紧邻前那条消息之后）
      const anchorTurnId = clone.approval?.anchorTurnId;
      const anchorItemId = clone.approval?.anchorItemId;
      let insertAt = -1;
      if (anchorTurnId) {
        // 找到属于该 turn 的最后一条 user/assistant 消息
        for (let j = this.messages.length - 1; j >= 0; j--) {
          if (this.messages[j].turnId === anchorTurnId
              && (this.messages[j].role === "user" || this.messages[j].role === "assistant")) {
            insertAt = j;
            break;
          }
        }
      }
      if (insertAt < 0 && anchorItemId) {
        for (let j = 0; j < this.messages.length; j++) {
          if (this.messages[j].itemId === anchorItemId) { insertAt = j; break; }
        }
      }
      if (insertAt < 0) {
        // fallback：找不到锚点就追加到末尾
        this.messages.push(clone);
      } else {
        // 插到锚点之后；跟锚点对齐 createdAt，避免 day 分隔符异常
        clone.createdAt = this.messages[insertAt].createdAt || clone.createdAt || Date.now();
        this.messages.splice(insertAt + 1, 0, clone);
      }
      mergedCount++;
    }
    void mergedCount;
  }

  /** 若外部（切 thread / 关面板）需要放弃未决审批，一次性 decline 掉 */
  findPendingApprovalByRequestId(requestId: string | number): ChatMessage | undefined {
    return this.messages.find(m =>
      m.role === "approval" && m.approval && !m.approval.decision && m.approval.requestId === requestId
    );
  }

  // 全部选中/取消
  async selectAllMessages(selected: boolean): Promise<void> {
    this.messages.forEach(m => { (m as any).selected = selected; });
    if (this.currentThread) {
      this.emit("messagesUpdated", { threadId: this.currentThread.id, messages: this.messages });
    }
  }

  // 复制（前端用 navigator.clipboard，这里只暴露 content 提取）
  getMessageContent(messageId: string): string {
    return this.messages.find(m => m.id === messageId)?.content || "";
  }

  // 重新生成（assistant 消息）：清空 content，复用同一个 user prompt 让 minimax 重新生成
  async regenerateMessage(messageId: string): Promise<void> {
    if (!this.currentThread) return;
    // 找要重新生成的消息
    const msg = this.messages.find(m => m.id === messageId);
    if (!msg || msg.role !== "assistant") return;
    // 找前一个 user 消息（生成它的 prompt）
    const idx = this.messages.findIndex(m => m.id === messageId);
    if (idx === -1) return;
    let userMsg: ChatMessage | undefined;
    for (let i = idx - 1; i >= 0; i--) {
      if (this.messages[i].role === "user") { userMsg = this.messages[i]; break; }
    }
    if (!userMsg) return;
    // 清空原内容，标记 streaming
    msg.content = "";
    msg.streaming = true;
    msg.error = undefined;
    this.emit("messagesUpdated", { threadId: this.currentThread.id, messages: this.messages });
    // 重新调 minimax
    try {
      const context = await this.buildContext(userMsg.content);
      const res = await this.client.turnStart({
        threadId: this.currentThread.id,
        input: [{ type: "text", text: context }],
        cwd: this.currentThread.cwd,
        ...(this.settings.model ? { model: this.settings.model } : {}),
        ...(this.settings.modelProvider ? { modelProvider: this.settings.modelProvider } : {}),
        approvalPolicy: sanitizeApprovalPolicy(this.settings.approvalPolicy),
      });
      const firstItem = res.turn?.items?.[0];
      if (firstItem) { msg.itemId = firstItem.id; msg.turnId = res.turn.id; }
    } catch (e: any) {
      msg.streaming = false;
      msg.error = e.message;
      this.emit("messagesUpdated", { threadId: this.currentThread.id, messages: this.messages });
    }
  }


  // === 多选/导出（前端 toolbar 调用）===

  // 获取当前选中的消息 IDs（按 messages 数组顺序）
  getSelectedMessageIds(): string[] {
    return this.messages
      .filter(m => (m as any).selected)
      .map(m => m.id);
  }

  // 清除所有消息的选中
  async clearSelection(): Promise<void> {
    this.messages.forEach(m => { (m as any).selected = false; });
    if (this.currentThread) {
      this.emit("messagesUpdated", { threadId: this.currentThread.id, messages: this.messages });
    }
  }

  // 把选中的消息导出为 Markdown 笔记（返回保存路径）
  async exportSelectedMessages(): Promise<string> {
    return _exportSelectedMessages(this.messages, {
      app: this.app,
      currentNote: this.currentNote,
      exportFolder: this.settings.exportFolder,
    });
  }
  // 翻译（assistant 消息）：用 minimax 重新生成，但 instruction 是"翻译下面这段"
  async translateMessage(messageId: string, targetLang: string = "中文"): Promise<void> {
    if (!this.currentThread) return;
    const msg = this.messages.find(m => m.id === messageId);
    if (!msg || msg.role !== "assistant") return;
    const originalContent = msg.content;
    msg.content = "";
    msg.streaming = true;
    msg.error = undefined;
    this.emit("messagesUpdated", { threadId: this.currentThread.id, messages: this.messages });
    try {
      const prompt = `请将以下内容翻译成${targetLang}，保持原意：

${originalContent}`;
      const res = await this.client.turnStart({
        threadId: this.currentThread.id,
        input: [{ type: "text", text: prompt }],
        cwd: this.currentThread.cwd,
        ...(this.settings.model ? { model: this.settings.model } : {}),
        ...(this.settings.modelProvider ? { modelProvider: this.settings.modelProvider } : {}),
        approvalPolicy: sanitizeApprovalPolicy(this.settings.approvalPolicy),
      });
      const firstItem = res.turn?.items?.[0];
      if (firstItem) { msg.itemId = firstItem.id; msg.turnId = res.turn.id; }
    } catch (e: any) {
      msg.streaming = false;
      msg.error = e.message;
      this.messages.find(m => m.id === messageId)!.content = originalContent;  // 还原
      this.emit("messagesUpdated", { threadId: this.currentThread.id, messages: this.messages });
    }
  }
  async unarchiveThread(threadId: string): Promise<void> {
    await this.client.threadUnarchive(threadId);
  }

  async deleteThread(threadId: string): Promise<void> {
    await this.client.threadDelete(threadId);
  }

  /**
   * 批量清空本插件创建过的所有 threads（通过 ThreadRegistry 追溯）
   * - 只删本插件 registry 里记录的 thread id，不碰其他来源的 thread
   * - 逐个调 threadDelete；若某个失败继续删下一个
   * - 清空 registry map
   * - 返回 {deleted, failed}
   */
  async purgePluginThreads(): Promise<{ deleted: number; failed: number }> {
    const entries = this.registry.all();
    let deleted = 0;
    let failed = 0;
    for (const { threadId } of entries) {
      try {
        await this.client.threadDelete(threadId);
        deleted++;
      } catch (e) {
        // 已经不存在 / 网络错误 —— 记为 failed 但继续
        failed++;
      }
    }
    // 无论删远端是否全部成功，都清空本地 registry（避免下次启动尝试恢复不存在的 thread）
    for (const { notePath } of entries) {
      try { await this.registry.delete(notePath); } catch { /* ignore */ }
    }
    // 清空当前 thread
    this.currentThread = null;
    this.messages = [];
    this.emit("messagesUpdated", { messages: [] });
    this.emit("threadChanged", { thread: null });
    return { deleted, failed };
  }

  async renameThread(threadId: string, newName: string): Promise<void> {
    await this.client.threadSetName(threadId, newName);
  }

  // 打开 thread 关联的笔记（如果还在 threadMap 里）
  async openNoteForThread(threadId: string): Promise<void> {
    const notePath = this.registry.reverseLookup(threadId);
    if (!notePath) return;
    const file = this.app.vault.getAbstractFileByPath(notePath);
    if (file && file instanceof TFile) {
      const leaf = this.app.workspace.getLeaf();
      await leaf.openFile(file);
    }
  }

  getCurrentNote(): TFile | null { return this.currentNote; }
  getCurrentThread(): CodexThread | null { return this.currentThread; }
  getMessages(): ChatMessage[] { return this.messages; }
  isClientReady(): boolean { return this.client.isConnected(); }
  getApprovalPolicy(): string { return this.settings.approvalPolicy; }
  /** 通过 thread id 反查关联笔记路径（未关联返回 undefined） */
  getNotePathByThreadId(threadId: string): string | undefined {
    return this.registry.reverseLookup(threadId);
  }
  setModel(model: string): void { this.settings.model = model; }
  getModel(): string { return this.settings.model; }

  setApprovalPolicy(p: "never" | "on-request" | "granular" | "untrusted"): void {
    this.settings.approvalPolicy = sanitizeApprovalPolicy(p);
  }



}
