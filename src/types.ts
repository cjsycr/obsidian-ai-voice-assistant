// 共享类型定义

// 默认预设：从 JSON 加载（esbuild 会 inline 进 bundle）
import defaultQuickPromptsData from "./data/default-quick-prompts.json";
import defaultSlashCommandsData from "./data/default-slash-commands.json";

// ===== Codex 协议类型（基于 app-server JSON Schema）=====

export type SessionSource =
  | "cli" | "vscode" | "exec" | "appServer" | "unknown"
  | { custom: string };

export type ThreadStatus = "queued" | "running" | "completed" | "failed" | "interrupted";

export interface CodexThread {
  id: string;            // UUIDv7
  name: string | null;
  preview: string;        // 首条用户消息
  cwd: string;            // 工作目录
  path?: string | null;
  source: SessionSource;
  modelProvider: string;
  status: ThreadStatus;
  createdAt: number;
  updatedAt: number;
  sessionId: string;
  parentThreadId?: string | null;
  ephemeral?: boolean;
  cliVersion: string;
  threadSource?: string | null;
}

export interface ThreadListResponse {
  data: CodexThread[];
  nextCursor?: string | null;
  backwardsCursor?: string | null;
}

export interface ThreadStartParams {
  cwd: string;
  name?: string;
  threadSource?: string;
  model?: string;
  modelProvider?: string;
  personality?: string;
  sandbox?: "read-only" | "workspace-write" | "danger-full-access";
  approvalPolicy?: "never" | "on-request" | "granular" | "untrusted";
  ephemeral?: boolean;
  baseInstructions?: string;
  developerInstructions?: string;
  serviceName?: string;
}

export interface ThreadStartResponse {
  thread: CodexThread;
  cwd: string;
  model: string;
  modelProvider: string;
  sandbox: string;
  approvalPolicy: string;
  approvalsReviewer?: string;
  instructionSources?: string[];
}

export interface ThreadResumeParams {
  threadId: string;
  history?: "legacy" | "paginated";
  path?: string;
}

export interface UserInputText {
  type: "text";
  text: string;
}
export interface UserInputImage {
  type: "image";
  url: string;
}
export type UserInput = UserInputText | UserInputImage;

export interface TurnStartParams {
  threadId: string;
  input: UserInput[];
  cwd?: string;
  model?: string;
  modelProvider?: string;
  personality?: string;
  effort?: "low" | "medium" | "high" | "extra-high";
  summary?: string;
  serviceTier?: string;
  sandboxPolicy?: string;
  outputSchema?: object;
  approvalPolicy?: string;
}

export type TurnStatus = "queued" | "inProgress" | "completed" | "interrupted" | "failed";

export interface Turn {
  id: string;
  status: TurnStatus;
  items: TurnItem[];
  error?: { message: string; codexErrorInfo?: any } | null;
}

export type TurnItem =
  | { type: "userMessage"; id: string; content: UserInput[] }
  | { type: "agentMessage"; id: string; content: UserInputText[] }
  | { type: "reasoning"; id: string; summary: string }
  | { type: "commandExecution"; id: string; command: string; status: string; output?: string }
  | { type: "fileChange"; id: string; changes: any[]; status: string }
  | { type: "mcpToolCall"; id: string; server: string; tool: string; arguments: any; result?: any; status: string };

// ===== 通知事件（流式）=====
export interface AgentMessageDeltaNotification {
  method: "item/agentMessage/delta";
  params: { threadId: string; turnId: string; itemId: string; delta: string };
}

export interface TurnCompletedNotification {
  method: "turn/completed";
  params: { threadId: string; turn: Turn };
}

export interface TurnStartedNotification {
  method: "turn/started";
  params: { threadId: string; turn: Turn };
}

// ===== UI/插件层类型 =====

export interface ChatMessage {
  id: string;                  // UI 唯一 ID
  role: "user" | "assistant" | "system" | "approval";
  content: string;             // 已累积的内容
  streaming?: boolean;         // 是否正在流式接收
  createdAt: number;
  turnId?: string;
  itemId?: string;             // 用于增量更新
  error?: string;
  // 思考过程字段
  reasoning?: string;
  reasoningStreaming?: boolean;
  reasoningItemId?: string;
  reasoningCollapsed?: boolean;
  // 多选态（UI-only）
  selected?: boolean;
  // === role: "approval" 专用 ===
  // 未决 → decision 为 undefined；用户点按钮后写入并触发一次 renderMessages
  approval?: {
    kind: "exec" | "patch";
    command?: string;                            // 已 shell-escape 拼好的整串
    cwd?: string;
    reason?: string;
    fileChanges?: Array<{ path: string; type?: string }>;
    grantRoot?: string;
    decision?: "accept" | "acceptForSession" | "decline" | "cancel";
    decidedAt?: number;
    // Codex JSON-RPC request id：用于把决策发回去 & 后续查找
    requestId?: string | number;
    // 锚点：审批发生时所在的 turn（rebuild 前后 turnId 稳定）
    // 用它跨 session 把 approval 插回原 turn 的末尾
    anchorTurnId?: string;
    // 兜底锚点：审批发生瞬间紧邻前的消息 itemId
    anchorItemId?: string;
  };
}

export interface ThreadMap {
  // 笔记相对路径（在 vault 内） → Codex thread ID
  [notePath: string]: string;
}

export interface PluginSettings {
  // 核心：codex CLI 路径
  codexPath: string;

  // vault 根目录（自动从 Obsidian app 推断，理论上不需要手动设）
  vaultRoot: string;

  // 标识
  threadNamePrefix: string;        // 默认 "🤖 "，可在前缀里标识 AI 工作
  threadSource: string;            // 默认 "obsidian-ai-assistant"

  // 自动行为
  autoResumeOnNoteOpen: boolean;   // 打开笔记时自动恢复/创建 thread
  archiveOnNoteClose: boolean;     // 关闭笔记时归档 thread

  // 模型
  model: string;
  modelProvider: string;

  // 沙箱
  approvalPolicy: "never" | "on-request" | "granular" | "untrusted";
  // 字体大小（消息区，10-20）
  messageFontSize: number;
  // 思考过程默认是否折叠
  reasoningDefaultCollapsed: boolean;
  // 前置提示词（thread 级别 baseInstructions）
  customInstructions: string;
  // 仓库位置列表（告诉 AI 这些是你的本地仓库）
  repoLocations: RepoLocation[];

  // 导出文件夹（多选导出时使用，相对 vault 根）
  exportFolder: string;

  // 快捷指令模板（输入框左下角胶囊）
  quickPrompts: QuickPromptItem[];
  // 斜杠指令（/ 按钮弹出面板）
  slashCommands: SlashCommandItem[];

  // 首启动引导是否已完成（false → 首次打开对话面板会弹 tour）
  // 底部状态栏显示上下文用量
  showStatusBar: boolean;
  tourCompleted: boolean;
}

// 快捷指令模板项
export interface QuickPromptItem {
  name: string;   // 显示名 e.g. "📝 总结"
  prompt: string; // 填入输入框的提示词
}

// 斜杠指令项（skill 风格）
export interface SlashCommandItem {
  trigger: string;    // e.g. "summarize"
  name: string;       // 显示名
  description: string; // 说明
  prompt: string;     // 填入输入框的提示词
  icon?: string;      // Lucide 图标名（可选）
  category?: string;  // 分类（可选，如 "笔记"/"翻译"/"创作"/"技术"）
}

// 仓库位置类型
export interface RepoLocation {
  name: string;   // 显示名（如 "工作笔记"、"代码项目"）
  path: string;   // 绝对路径
}

// 默认预设 —— 从 JSON 加载并强类型化
export const DEFAULT_QUICK_PROMPTS: QuickPromptItem[] = defaultQuickPromptsData as QuickPromptItem[];
export const DEFAULT_SLASH_COMMANDS: SlashCommandItem[] = defaultSlashCommandsData as SlashCommandItem[];

export const DEFAULT_SETTINGS: PluginSettings = {
  codexPath: "codex",
  vaultRoot: "",
  threadNamePrefix: "🤖 ",
  threadSource: "obsidian-ai-assistant",
  autoResumeOnNoteOpen: true,
  archiveOnNoteClose: false,
  // 默认用 minimax 用户的实际配置（不要写 openai/gpt-5）
  model: "",  // 空 = 跟随全局 config.toml
  modelProvider: "",  // 空 = 跟随全局 config.toml
  approvalPolicy: "on-request",
  messageFontSize: 13,
  reasoningDefaultCollapsed: true,
  customInstructions: "",
  repoLocations: [],
  exportFolder: "exports",
  quickPrompts: DEFAULT_QUICK_PROMPTS,
  slashCommands: DEFAULT_SLASH_COMMANDS,
  showStatusBar: true,
  tourCompleted: false,
};

// ===== JSON-RPC 通用 =====
export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number | string;
  method: string;
  params?: any;
}

export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number | string;
  result?: any;
  error?: { code: number; message: string; data?: any };
}

export interface JsonRpcNotification {
  jsonrpc: "2.0";
  method: string;
  params?: any;
}

// ===== 附件类型（图片粘贴用）=====
export interface PastedImageAttachment {
  kind: "pasted-image";
  id: string;
  path: string;
  mimeType: string;
  sizeBytes: number;
  width?: number;
  height?: number;
}

export type ComposerAttachment = PastedImageAttachment;
// 未来可扩展 vault-file 等类型
