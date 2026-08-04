// Codex 审批请求
// 两种载体：Modal（fallback）+ 侧边栏内嵌卡片（默认）
// 决策：accept | acceptForSession | decline | cancel

import { App, Modal, setIcon, Notice } from "obsidian";

export type ReviewDecision = "accept" | "acceptForSession" | "decline" | "cancel";

export interface ApprovalRequest {
  kind: "exec" | "patch";
  callId?: string;
  // exec
  command?: string[] | string;
  cwd?: string;
  reason?: string;
  // patch
  fileChanges?: any;
  grantRoot?: string;
}

// ② 危险命令高亮：命中即在卡片顶部出红条 + 默认焦点强制落在"拒绝"
// 说明：正则永远漏得掉真正阴险的命令，这只是"提醒"而非"保证"。
const DANGER_PATTERNS: Array<{ re: RegExp; label: string }> = [
  { re: /\brm\s+(-[a-zA-Z]*[rf][a-zA-Z]*\s+|\-{2}recursive|\-{2}force)/, label: "rm -rf" },
  { re: /\bsudo\b/, label: "sudo" },
  { re: /\bchmod\s+([0-7]?7[0-7]{2}|-R)/, label: "chmod 高权限" },
  { re: /\bchown\b/, label: "chown" },
  { re: /\|\s*(sh|bash|zsh|python|python3|node|ruby|perl)\b/, label: "管道执行外部脚本" },
  { re: /\bcurl\b[^|]*\|\s*(sh|bash|zsh)/, label: "curl | sh" },
  { re: /\bwget\b[^|]*\|\s*(sh|bash|zsh)/, label: "wget | sh" },
  { re: /\bmkfs\./, label: "mkfs" },
  { re: /\bdd\s+.*of=\/dev\//, label: "dd 写入设备" },
  { re: />\s*\/dev\/(sd|nvme|disk)/, label: "写入设备文件" },
  { re: /:\(\)\s*\{\s*:\|:/, label: "fork bomb" },
  { re: /\beval\s+/, label: "eval" },
  { re: /\bkill(all)?\s+-9\b/, label: "kill -9" },
  { re: /\blaunchctl\s+(load|unload|bootstrap|kickstart)/, label: "launchctl 系统服务" },
  { re: /\bdefaults\s+(write|delete)\b/, label: "defaults write" },
  { re: /\bnetsh\b|\bfirewall\b/, label: "防火墙修改" },
  { re: /\/etc\/(passwd|shadow|sudoers|hosts)\b/, label: "编辑系统文件" },
];

function detectDangerPatterns(cmd: string): string[] {
  const hits: string[] = [];
  for (const { re, label } of DANGER_PATTERNS) {
    if (re.test(cmd)) hits.push(label);
  }
  return hits;
}

function truncate(s: string, n = 2000): string {
  return s.length > n ? s.slice(0, n) + "…" : s;
}

function stringifyCommand(raw: unknown): string {
  if (Array.isArray(raw)) {
    return raw
      .map(a => /[\s"'$&|;`]/.test(String(a)) ? JSON.stringify(String(a)) : String(a))
      .join(" ");
  }
  if (typeof raw === "string") return raw;
  if (raw == null) return "";
  try { return JSON.stringify(raw); } catch { return String(raw); }
}

export interface RenderCardOptions {
  /** 容器；卡片会 append 到这里 */
  container: HTMLElement;
  req: ApprovalRequest;
  /** 用户做决定的回调；只会被调用一次 */
  onDecide: (d: ReviewDecision) => void;
  /** true=卡片模式（侧边栏内嵌）；false=Modal 模式（略微不同的间距/说明） */
  compact?: boolean;
}

/**
 * 统一渲染审批卡片。返回一个"标记已决策 & 更新为历史记录"的 handle。
 * 这样 Modal 和侧边栏方案都能复用同一个视觉。
 */
export function renderApprovalCard(opts: RenderCardOptions): {
  root: HTMLElement;
  markResolved: (d: ReviewDecision) => void;
} {
  const { container, req, onDecide, compact } = opts;
  const isExec = req.kind === "exec";
  let decided = false;

  const cmdText = isExec ? stringifyCommand(req.command) : "";
  const dangers = isExec ? detectDangerPatterns(cmdText) : [];

  const root = container.createDiv({
    cls: "ai-approval-card" + (compact ? " ai-approval-card--compact" : "") + (dangers.length ? " danger" : ""),
  });

  // 标题
  const head = root.createDiv({ cls: "ai-approval-head" });
  const iconWrap = head.createSpan({ cls: "ai-approval-head-icon" });
  setIcon(iconWrap, dangers.length ? "alert-triangle" : (isExec ? "terminal" : "file-diff"));
  head.createSpan({
    cls: "ai-approval-head-title",
    text: isExec ? "Codex 请求执行命令" : "Codex 请求修改文件",
  });
  if (dangers.length) {
    head.createSpan({ cls: "ai-approval-danger-flag", text: "高风险" });
  }

  // ① reason 拎到顶部（在命令之前）
  if (req.reason) {
    const reasonEl = root.createDiv({ cls: "ai-approval-reason-top" });
    reasonEl.createSpan({ cls: "ai-approval-reason-label", text: "目的：" });
    reasonEl.createSpan({ text: req.reason });
  }

  // 主体
  const body = root.createDiv({ cls: "ai-approval-body" });
  try {
    if (isExec) {
      const codeWrap = body.createDiv({ cls: "ai-approval-code-wrap" });
      const pre = codeWrap.createEl("pre", { cls: "ai-approval-code" });
      pre.textContent = truncate(cmdText, 2000);
      // ③ 复制按钮
      const copyBtn = codeWrap.createEl("button", {
        cls: "ai-approval-copy",
        attr: { "aria-label": "复制命令", type: "button" },
      });
      setIcon(copyBtn, "copy");
      copyBtn.addEventListener("click", async (ev) => {
        ev.stopPropagation();
        try {
          await navigator.clipboard.writeText(cmdText);
          new Notice("已复制命令");
        } catch {
          // fallback：不用 execCommand（deprecated），直接提示
          new Notice("复制失败，请手动选中");
        }
      });
      if (req.cwd) {
        body.createDiv({ cls: "ai-approval-meta", text: "工作目录：" + req.cwd });
      }
      if (dangers.length) {
        body.createDiv({
          cls: "ai-approval-danger-note",
          text: "检测到高风险模式：" + dangers.join("、") + " · 请务必确认命令与路径正确",
        });
      }
    } else {
      const list = body.createEl("ul", { cls: "ai-approval-filelist" });
      const fc = req.fileChanges;
      let entries: Array<{ path: string; type?: string }> = [];
      if (Array.isArray(fc)) {
        entries = fc.map((x: any) => ({ path: String(x?.path ?? x), type: x?.type }));
      } else if (fc && typeof fc === "object") {
        for (const [k, v] of Object.entries(fc)) {
          entries.push({ path: k, type: (v as any)?.type });
        }
      }
      for (const e of entries) {
        const li = list.createEl("li");
        if (e.type) li.createSpan({ cls: "ai-approval-file-kind", text: `[${e.type}] ` });
        li.createSpan({ cls: "ai-approval-file-path", text: e.path });
      }
      if (entries.length === 0) list.createEl("li", { text: "(无文件变更详情)" });
      if (req.grantRoot) {
        body.createDiv({ cls: "ai-approval-meta", text: "写入根：" + req.grantRoot });
      }
    }
  } catch (err) {
    console.error("[approval] render body failed:", err, req);
    body.createDiv({ text: "(渲染详情失败，可查看 devtools console)" });
  }

  // 按钮
  const btnRow = root.createDiv({ cls: "ai-approval-btnrow" });
  const buttons: HTMLButtonElement[] = [];
  const mkBtn = (text: string, cls: string, decision: ReviewDecision) => {
    const b = btnRow.createEl("button", { text, cls: "ai-approval-btn " + cls, attr: { type: "button" } });
    b.addEventListener("click", (ev) => {
      ev.stopPropagation();
      if (decided) return;
      decide(decision);
    });
    buttons.push(b);
    return b;
  };

  const declineBtn = mkBtn("拒绝", "ai-approval-btn-ghost", "decline");
  mkBtn("中止 Turn", "ai-approval-btn-ghost", "cancel");
  const acceptBtn = mkBtn("本次批准", "ai-approval-btn-primary", "accept");
  mkBtn("本会话都批准", "ai-approval-btn-primary-strong", "acceptForSession");

  // ② 危险命令：默认焦点强制落在"拒绝"
  const focusTarget = dangers.length ? declineBtn : acceptBtn;
  // 200ms 后再 focus，避开发送键残留的 Enter
  setTimeout(() => {
    try { focusTarget.focus({ preventScroll: true } as any); } catch { /* ignore */ }
  }, 200);

  function decide(d: ReviewDecision): void {
    if (decided) return;
    decided = true;
    try { onDecide(d); } finally { markResolved(d); }
  }

  function markResolved(d: ReviewDecision): void {
    decided = true;
    // 决策完成 → 冻结按钮（视觉反馈短暂持续，实际节点由外层重绘负责替换/移除）
    for (const b of buttons) b.disabled = true;
    btnRow.addClass("ai-approval-btnrow--resolved");
    root.dataset.decision = d;
  }

  return { root, markResolved };
}

/** Modal fallback：当侧边栏拿不到时兜底 */
export class CodexApprovalModal extends Modal {
  private req: ApprovalRequest;
  private onDecide: (d: ReviewDecision) => void;
  private decided = false;

  constructor(app: App, req: ApprovalRequest, onDecide: (d: ReviewDecision) => void) {
    super(app);
    this.req = req;
    this.onDecide = onDecide;
  }

  onOpen(): void {
    const { contentEl, titleEl } = this;
    titleEl.setText("");
    contentEl.empty();
    contentEl.addClass("ai-approval-modal");

    renderApprovalCard({
      container: contentEl,
      req: this.req,
      onDecide: (d) => {
        if (this.decided) return;
        this.decided = true;
        try { this.onDecide(d); } finally { this.close(); }
      },
    });

    this.scope.register([], "Escape", (e) => {
      e.preventDefault();
      if (this.decided) return;
      this.decided = true;
      try { this.onDecide("decline"); } finally { this.close(); }
    });
  }

  onClose(): void {
    if (!this.decided) {
      this.decided = true;
      try { this.onDecide("decline"); } catch { /* ignore */ }
    }
    this.contentEl.empty();
  }
}
