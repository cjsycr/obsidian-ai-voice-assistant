// CodexClient: 与 Codex app-server 通信的 JSON-RPC 客户端
// 走 stdio 模式（spawn codex app-server --stdio）
//
// 关键修复：Obsidian 在 spawn 子进程时 env 可能为空，
// 所以"codex"这种 PATH-relative 名字找不到。必须用绝对路径。

import { spawn, ChildProcess } from "child_process";
import { EventEmitter } from "events";
import * as readline from "readline";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  JsonRpcRequest, JsonRpcNotification,
  ThreadStartParams, ThreadStartResponse,
  TurnStartParams, Turn,
  AgentMessageDeltaNotification, TurnCompletedNotification,
  ThreadResumeParams, ThreadListResponse,
} from "../types";

// ④ 已知无须处理的 Codex 通知 method 列表
// 这些通知是 Codex app-server 定期心跳/状态广播，渲染层不关心。
// 命中即静默；未命中的 method 才打 warn，方便发现协议变化。
const KNOWN_SILENT_METHODS: ReadonlySet<string> = new Set([
  // item 生命周期：具体渲染由 turn/completed 处理
  "item/started",
  "item/completed",
  "item/updated",
  "item/reasoning/summaryPartAdded",
  // token 用量 / rate limit / 状态心跳
  "thread/tokenUsage/updated",
  "thread/status/changed",
  "account/rateLimits/updated",
  // server request 完成回执（我们已经在 sendResponse 里处理过决策）
  "serverRequest/resolved",
  // 远程控制、thread 名字变化（后者已由 threadStart 后的 setName 处理）
  "remoteControl/status/changed",
  "thread/name/updated",
]);
function isKnownSilentMethod(method?: string): boolean {
  if (!method) return false;
  if (KNOWN_SILENT_METHODS.has(method)) return true;
  // MCP 服务器状态通知（每次创建 thread 会刷一堆）
  if (method.startsWith("mcpServer/")) return true;
  return false;
}

// 常见 codex CLI 位置（按优先级尝试）
const COMMON_CODEX_PATHS = [
  "/Applications/ChatGPT.app/Contents/Resources/codex",  // Mac Codex 桌面 app 内嵌
  "/usr/local/bin/codex",
  "/opt/homebrew/bin/codex",
  path.join(os.homedir(), ".local/bin/codex"),
  path.join(os.homedir(), ".codex/bin/codex"),
];

export class CodexClient extends EventEmitter {
  private child: ChildProcess | null = null;
  private nextId = 1;
  private pending = new Map<number | string, { resolve: (v: any) => void; reject: (e: any) => void }>();
  private connected = false;
  private codexPath: string;
  private vaultRoot: string;
  private stderrBuf: string = "";

  constructor(codexPath: string, vaultRoot: string) {
    super();
    this.codexPath = codexPath;
    this.vaultRoot = vaultRoot;
  }

  // 解析 codex 实际路径（处理 Obsidian 环境 PATH 缺失问题）
  private resolveCodexPath(): string {
    // 1. 用户给的路径如果包含 / 或者是绝对路径，直接验证
    if (this.codexPath && (this.codexPath.includes("/") || this.codexPath.includes(path.sep))) {
      if (fs.existsSync(this.codexPath)) return this.codexPath;
      throw new Error(`codexPath 不存在: ${this.codexPath}\n请在插件设置里填正确的 codex 路径`);
    }

    // 2. 尝试常见位置
    for (const p of COMMON_CODEX_PATHS) {
      try { if (fs.existsSync(p)) return p; } catch {}
    }

    // 3. 尝试用 which（万一 PATH 还在）
    try {
      const which = spawn("/usr/bin/env", ["which", this.codexPath], { stdio: "pipe" });
      let out = "";
      which.stdout.on("data", d => out += d.toString());
      which.on("exit", code => {
        const p = out.trim();
        if (code === 0 && p && fs.existsSync(p)) {
          // 不在这里直接返回，spawn 是异步的
        }
      });
    } catch {}

    throw new Error(
      `找不到 codex CLI（已尝试 ${COMMON_CODEX_PATHS.length + 1} 个位置）。\n` +
      `请在插件设置面板里填 codex 的绝对路径。\n` +
      `Mac Codex 桌面 App 用户填：/Applications/ChatGPT.app/Contents/Resources/codex`
    );
  }

  async start(): Promise<void> {
    if (this.connected) return;

    // 解析路径
    let resolvedPath: string;
    try {
      resolvedPath = this.resolveCodexPath();
    } catch (e: any) {
      throw e;
    }
    this.codexPath = resolvedPath;

    return new Promise((resolve, reject) => {
      this.stderrBuf = "";

      // 强制传 env（带 PATH），避免 Obsidian 的空 env
      // 不再硬编码 OPENAI_BASE_URL —— 让 ~/.codex/config.toml 的 base_url 生效
      // （CC-Switch 等工具会修改 config.toml，硬编码 env 会覆盖它们）
      const childEnv: NodeJS.ProcessEnv = {
        ...process.env,
        PATH: process.env.PATH || [
          "/usr/local/bin", "/opt/homebrew/bin", "/usr/bin", "/bin",
          path.join(os.homedir(), ".local/bin"),
        ].join(":"),
        HOME: process.env.HOME || os.homedir(),
        // 只有 env 里已有 OPENAI_BASE_URL 时才传（不覆盖 config.toml）
        ...(process.env.OPENAI_BASE_URL ? { OPENAI_BASE_URL: process.env.OPENAI_BASE_URL } : {}),
      };

      this.child = spawn(this.codexPath, ["app-server", "--stdio"], {
        stdio: ["pipe", "pipe", "pipe"],
        env: childEnv,
        cwd: this.vaultRoot || undefined,
      });

      // 把 stderr 暴露给 console（用户能看到 Codex 启动日志）
      this.child.stderr?.on("data", (d) => {
        this.stderrBuf += d.toString();
        // 只把 WARN/ERROR 级别转发到 console，避免日志刷屏
        const s = d.toString();
        if (s.includes("ERROR") || s.includes("FATAL")) {
          console.warn("[codex]", s.trim());
        }
      });

      this.child.on("exit", (code, signal) => {
        const wasConnected = this.connected;
        this.connected = false;
        this.child = null;
        this.rejectAllPending(new Error(`codex app-server exited (code=${code}, signal=${signal})`));
        if (wasConnected) {
          this.emit("disconnected", `exit code ${code}`);
        } else if (!this.stderrBuf.includes("WARN")) {
          // 启动就退出了，stderr 又没东西
          console.error("[codex] 启动后立即退出，stderr:", this.stderrBuf.substring(0, 500));
        }
      });

      this.child.on("error", (e) => {
        console.error("[codex] spawn error:", e.message, "path:", this.codexPath);
        this.emit("error", e);
        reject(new Error(`启动 codex 失败：${e.message}\n路径：${this.codexPath}`));
      });

      const rl = readline.createInterface({ input: this.child.stdout! });
      rl.on("line", (line) => this.handleLine(line));

      // initialize 握手
      this.request("initialize", {
        clientInfo: { name: "ai-whispers", version: "0.1.0" },
        capabilities: { experimentalApi: true },
      }).then(() => {
        this.connected = true;
        this.emit("ready");
        resolve();
      }).catch((e) => {
        reject(e);
        this.stop();
      });
    });
  }

  async stop(): Promise<void> {
    if (!this.child) return;
    this.connected = false;
    const child = this.child;
    this.child = null;
    return new Promise((resolve) => {
      child.on("exit", () => resolve());
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 2000);
    });
  }

  isConnected(): boolean { return this.connected && this.child !== null; }
  getCodexPath(): string { return this.codexPath; }
  getLastStderr(): string { return this.stderrBuf; }

  async request<T = any>(method: string, params?: any): Promise<T> {
    if (!this.child?.stdin) {
      // 自动重连（一次）— child 死了但 connected 标志 stale
      try {
        await this.start();
      } catch (e) {
        // 仍失败就抛
      }
      if (!this.child?.stdin) {
        throw new Error("codex app-server not started");
      }
    }
    const id = this.nextId++;
    const req: JsonRpcRequest = { jsonrpc: "2.0", id, method, params };
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.child!.stdin!.write(JSON.stringify(req) + "\n");
    });
  }

  private handleLine(line: string): void {
    if (!line.startsWith("{")) return;
    let msg: any;
    try { msg = JSON.parse(line); } catch { return; }

    // client → server 请求的响应（我们发出去的调用回来了）
    if (msg.id !== undefined && this.pending.has(msg.id)) {
      const { resolve, reject } = this.pending.get(msg.id)!;
      this.pending.delete(msg.id);
      if (msg.error) reject(new Error(`${msg.error.message} (code=${msg.error.code})`));
      else resolve(msg.result);
      return;
    }

    // server → client 请求（method + id 同时存在）—— 需要回复 JSON-RPC response
    if (msg.method && msg.id !== undefined) {
      this.emit("serverRequest", msg);
      return;
    }
    // 纯通知（method 存在但没 id）
    if (msg.method) this.handleNotification(msg as JsonRpcNotification);
  }

  /** 上层调 approval handler 后，用这个把决定回给 Codex */
  sendResponse(id: number | string, result: any): void {
    if (!this.child?.stdin) return;
    // ⑤ 运行时校验：仅允许 Codex 认识的 4 个决策枚举，越权/拼错的调用第一时间在 devtools 看到 error
    if (result && typeof result === "object" && "decision" in result) {
      const ALLOWED = new Set(["accept", "acceptForSession", "decline", "cancel"]);
      if (!ALLOWED.has(String((result as any).decision))) {
        console.error(
          "[codex] sendResponse: invalid decision value",
          (result as any).decision,
          "— expected one of accept/acceptForSession/decline/cancel"
        );
        return; // 不发出去，让上层看到 AI 卡住比让 Codex 默默把它当 decline 好
      }
    }
    const payload = { jsonrpc: "2.0", id, result };
    try { this.child.stdin.write(JSON.stringify(payload) + "\n"); } catch (e) {
      console.error("[codex] sendResponse failed:", e);
    }
  }

  private handleNotification(notif: JsonRpcNotification): void {
    this.emit("notification", notif);
    switch (notif.method) {
      case "item/agentMessage/delta":
        this.emit("agentMessageDelta", notif.params);
        break;
      case "item/reasoning/textDelta":
        this.emit("reasoningDelta", notif.params);
        break;
      case "item/reasoning/summaryTextDelta":
        this.emit("reasoningSummaryDelta", notif.params);
        break;
      case "item/reasoning/completed":
        this.emit("reasoningCompleted", notif.params);
        break;
      case "turn/started":
        this.emit("turnStarted", notif.params);
        break;
      case "turn/completed":
        this.emit("turnCompleted", notif.params);
        break;
      case "turn/failed":
        this.emit("turnFailed", notif.params);
        break;
      default:
        // ④ 已知无须处理的通知白名单：静默吞掉，避免 devtools 被刷屏
        // 这些通知本身没 bug，只是渲染层不关心（token 用量、rate limit、状态心跳等）
        if (isKnownSilentMethod(notif.method)) break;
        // 其他真正未知的通知才打 warn（未来协议漂移能第一时间被发现）
        console.warn("[AI Assistant] unhandled notification:", notif.method,
          JSON.stringify(notif.params || {}).substring(0, 300));
        break;
    }
  }

  private rejectAllPending(err: Error): void {
    for (const [, { reject }] of this.pending) reject(err);
    this.pending.clear();
  }

  async threadStart(params: ThreadStartParams): Promise<ThreadStartResponse> {
    return this.request<ThreadStartResponse>("thread/start", params);
  }

  async threadResume(params: ThreadResumeParams): Promise<ThreadStartResponse> {
    return this.request<ThreadStartResponse>("thread/resume", params);
  }

  async threadList(opts: { cwd?: string; limit?: number; archived?: boolean } = {}): Promise<ThreadListResponse> {
    return this.request<ThreadListResponse>("thread/list", opts);
  }

  async threadArchive(threadId: string): Promise<void> {
    await this.request("thread/archive", { threadId });
  }

  async threadSetName(threadId: string, name: string): Promise<void> {
    await this.request("thread/name/set", { threadId, name });
  }

  async threadUnarchive(threadId: string): Promise<void> {
    await this.request("thread/unarchive", { threadId });
  }

  async threadDelete(threadId: string): Promise<void> {
    await this.request("thread/delete", { threadId });
  }

  async turnStart(params: TurnStartParams): Promise<{ turn: Turn }> {
    return this.request("turn/start", params);
  }

  async turnInterrupt(threadId: string, turnId?: string): Promise<void> {
    await this.request("turn/interrupt", { threadId, turnId });
  }
}
