// CodexThreadsView · v0.5.2 · 仪表盘卡片网格重设计（方案 E）
// - 顶部统计条（总计 / 活跃 / 归档 / 最近更新）
// - 2 列卡片网格
// - lucide icons + Notice + Modal（不再用 emoji/alert/confirm）
// - 青碧 (--ai-teal) 变量家族，与主聊天面板视觉一致

import { ItemView, WorkspaceLeaf, App, setIcon, Notice, Modal, Menu } from "obsidian";
import { NoteService } from "../obsidian/NoteService";

export const VIEW_TYPE_CODEX_THREADS = "ai-assistant-codex-threads";

interface ThreadRow {
  id: string;
  name: string | null;
  preview: string;
  cwd: string;
  archived: boolean;
  updatedAt: number;      // seconds (unix)
  isPluginThread: boolean;
  notePath?: string;
}

type FilterKind = "active" | "archived" | "all";

/** 相对时间：3 分钟前 / 3 小时前 / 昨天 21:12 / 周三 / 7/16 / 上月 */
function formatRelativeTime(unixSec: number): string {
  const now = Date.now();
  const t = unixSec * 1000;
  const diff = now - t;
  const min = 60 * 1000, hour = 60 * min, day = 24 * hour;
  if (diff < min) return "刚刚";
  if (diff < hour) return Math.floor(diff / min) + " 分钟前";
  if (diff < 6 * hour) return Math.floor(diff / hour) + " 小时前";
  const d = new Date(t);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const yest = new Date(today.getTime() - day);
  const startOfWeek = new Date(today); startOfWeek.setDate(today.getDate() - today.getDay());
  const hhmm = d.getHours().toString().padStart(2, "0") + ":" + d.getMinutes().toString().padStart(2, "0");
  if (t >= today.getTime()) return hhmm;
  if (t >= yest.getTime()) return "昨天 " + hhmm;
  if (t >= startOfWeek.getTime()) return "周" + "日一二三四五六"[d.getDay()];
  const sameYear = d.getFullYear() === new Date().getFullYear();
  if (sameYear) return (d.getMonth() + 1) + "/" + d.getDate();
  return d.getFullYear() + "/" + (d.getMonth() + 1) + "/" + d.getDate();
}

export class CodexThreadsView extends ItemView {
  private service: NoteService;
  private getThreadMap: () => Record<string, string>;
  private vaultRoot: string;
  private listEl: HTMLElement | null = null;
  private statsEl: HTMLElement | null = null;
  private countEl: HTMLElement | null = null;
  private filterEl: HTMLInputElement | null = null;
  private bulkBar: HTMLElement | null = null;
  private selectedCountEl: HTMLElement | null = null;
  private filterKind: FilterKind = "active";
  private filterChips: Record<FilterKind, HTMLElement> = {} as any;
  private threads: ThreadRow[] = [];
  private selectedIds = new Set<string>();

  constructor(leaf: WorkspaceLeaf, service: NoteService, getThreadMap: () => Record<string, string>, vaultRoot: string) {
    super(leaf);
    this.service = service;
    this.getThreadMap = getThreadMap;
    this.vaultRoot = vaultRoot;
  }

  getViewType(): string { return VIEW_TYPE_CODEX_THREADS; }
  getDisplayText(): string { return "Codex Threads"; }
  getIcon(): string { return "list-video"; }

  async onOpen(): Promise<void> {
    const root = this.containerEl.children[1] as HTMLElement;
    root.empty();
    root.addClass("ai-threads-view-e");

    // ===== 顶部标题 =====
    const header = root.createDiv({ cls: "aite-header" });
    const hIcon = header.createDiv({ cls: "aite-h-icon" });
    setIcon(hIcon, "list-video");
    header.createDiv({ cls: "aite-title", text: "Codex Thread 管理器" });
    this.countEl = header.createDiv({ cls: "aite-count" });

    root.createDiv({ cls: "aite-desc", text: "所有 Codex 桌面版中与本 vault 关联的 thread。在 Obsidian 内即可归档 / 恢复 / 重命名 / 批量操作。" });

    // ===== 统计条 =====
    this.statsEl = root.createDiv({ cls: "aite-stats" });

    // ===== 过滤条 =====
    const filterRow = root.createDiv({ cls: "aite-filter" });
    const searchWrap = filterRow.createDiv({ cls: "aite-search" });
    const sIcon = searchWrap.createDiv({ cls: "aite-search-icon" });
    setIcon(sIcon, "search");
    this.filterEl = searchWrap.createEl("input", {
      type: "text",
      placeholder: "搜索 thread（按名称或笔记路径）…",
    });
    this.filterEl.addEventListener("input", () => this.renderList());

    const chipRow = filterRow.createDiv({ cls: "aite-chip-row" });
    this.filterChips.active = this.makeChip(chipRow, "active", "check-check", "活跃");
    this.filterChips.archived = this.makeChip(chipRow, "archived", "archive", "已归档");
    this.filterChips.all = this.makeChip(chipRow, "all", "layers", "全部");

    const refreshBtn = filterRow.createEl("button", { cls: "aite-btn-ghost" });
    const rIcon = refreshBtn.createSpan();
    setIcon(rIcon, "refresh-cw");
    refreshBtn.createSpan({ text: " 刷新" });
    refreshBtn.addEventListener("click", () => this.refresh());

    // ===== 批量条 =====
    this.bulkBar = root.createDiv({ cls: "aite-bulkbar" });
    this.bulkBar.style.display = "none";
    const bulkLeft = this.bulkBar.createDiv({ cls: "aite-bulk-left" });
    this.selectedCountEl = bulkLeft.createSpan({ cls: "aite-bulk-count" });
    bulkLeft.createSpan({ text: " 项已选" });
    this.bulkBar.createDiv({ cls: "aite-bulk-spacer" });
    const mkBulkBtn = (label: string, icon: string, danger: boolean, fn: () => void) => {
      const b = this.bulkBar!.createEl("button", { cls: "aite-btn-" + (danger ? "danger" : "ghost") });
      const ic = b.createSpan();
      setIcon(ic, icon);
      b.createSpan({ text: " " + label });
      b.addEventListener("click", fn);
      return b;
    };
    mkBulkBtn("归档", "archive", false, () => this.bulkArchive());
    mkBulkBtn("恢复", "archive-restore", false, () => this.bulkUnarchive());
    mkBulkBtn("删除", "trash-2", true, () => this.bulkDelete());
    const clearBtn = this.bulkBar.createEl("button", { cls: "aite-btn-ghost" });
    const cIc = clearBtn.createSpan();
    setIcon(cIc, "x");
    clearBtn.createSpan({ text: " 取消" });
    clearBtn.addEventListener("click", () => { this.selectedIds.clear(); this.renderList(); });

    // ===== 列表 =====
    this.listEl = root.createDiv({ cls: "aite-list" });

    // ===== 底部 Footer：vault 路径 + 在访达打开 =====
    // ===== 底部 Footer：Codex thread 存储目录 + 在访达打开 =====
    const codexHome = this.getCodexHome();
    const sessionsDir = codexHome + "/sessions";
    const footer = root.createDiv({ cls: "aite-footer" });
    const pathEl = footer.createSpan({ cls: "aite-footer-path", text: sessionsDir });
    pathEl.setAttr("title", "Codex 会话记录目录：" + sessionsDir);
    const openBtn = footer.createEl("button", { cls: "aite-footer-btn", attr: { title: "在访达中打开 Codex 的 thread 存储目录" } });
    const oIc = openBtn.createSpan();
    setIcon(oIc, "folder-open");
    openBtn.createSpan({ text: " 在访达中打开" });
    openBtn.addEventListener("click", (e) => this.revealCodexDir(e));
    // 右键弹菜单：sessions / archived / root
    openBtn.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      this.showCodexDirMenu(e);
    });
    openBtn.setAttr("title", "点击打开 sessions/  · 右键选择其他子目录");

    await this.refresh();
  }

  private makeChip(container: HTMLElement, kind: FilterKind, icon: string, label: string): HTMLElement {
    const chip = container.createDiv({ cls: "aite-chip" + (this.filterKind === kind ? " active" : "") });
    const ic = chip.createSpan();
    setIcon(ic, icon);
    chip.createSpan({ text: " " + label });
    chip.addEventListener("click", () => {
      this.filterKind = kind;
      Object.entries(this.filterChips).forEach(([k, el]) => el.toggleClass("active", k === kind));
      this.refresh();
    });
    return chip;
  }

  async onClose(): Promise<void> {
    this.listEl = null;
  }

  private async refresh(): Promise<void> {
    const showArchived = this.filterKind !== "active";
    const all = await this.service.listAllThreads(showArchived);
    const threadMap = this.getThreadMap();
    const notePathByThreadId: Record<string, string> = {};
    for (const [notePath, tid] of Object.entries(threadMap)) {
      notePathByThreadId[tid] = notePath;
    }

    let rows = all
      .filter(x => {
        if (!x.t.cwd || x.t.cwd !== this.vaultRoot) return false;
        const name = x.t.name || "";
        const isInMap = !!notePathByThreadId[x.t.id];
        const isPluginByName = name.startsWith("[📓obsidian]") || name.startsWith("🤖 ");
        return isInMap || isPluginByName;
      })
      .map(x => ({
        id: x.t.id,
        name: x.t.name,
        preview: (x.t.preview || "").substring(0, 60),
        cwd: x.t.cwd,
        archived: x.isArchived,
        updatedAt: x.t.updatedAt,
        isPluginThread: !!notePathByThreadId[x.t.id],
        notePath: notePathByThreadId[x.t.id],
      } as ThreadRow));

    // 按 filterKind 二次过滤
    if (this.filterKind === "active") rows = rows.filter(r => !r.archived);
    else if (this.filterKind === "archived") rows = rows.filter(r => r.archived);

    rows.sort((a, b) => b.updatedAt - a.updatedAt);
    this.threads = rows;

    // 清理已消失的选择
    const ids = new Set(this.threads.map(t => t.id));
    for (const id of this.selectedIds) if (!ids.has(id)) this.selectedIds.delete(id);

    this.renderStats();
    this.renderList();
  }

  private renderStats(): void {
    if (!this.statsEl) return;
    this.statsEl.empty();
    const total = this.threads.length;
    const active = this.threads.filter(t => !t.archived).length;
    const archived = this.threads.filter(t => t.archived).length;
    const now = Date.now();
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const recent = this.threads.filter(t => t.updatedAt * 1000 >= today.getTime()).length;

    const mk = (n: string | number, l: string) => {
      const s = this.statsEl!.createDiv({ cls: "aite-stat" });
      s.createDiv({ cls: "aite-stat-n", text: String(n) });
      s.createDiv({ cls: "aite-stat-l", text: l });
    };
    mk(total, "总计");
    mk(active, "活跃");
    mk(archived, "已归档");
    mk(recent, "今日更新");

    if (this.countEl) {
      this.countEl.setText(total + " 个 · 活跃 " + active + " / 归档 " + archived);
    }
  }

  private renderList(): void {
    if (!this.listEl) return;
    this.listEl.empty();

    const filter = (this.filterEl?.value || "").toLowerCase().trim();
    const filtered = filter
      ? this.threads.filter(t => ((t.name || "") + " " + t.preview + " " + (t.notePath || "")).toLowerCase().includes(filter))
      : this.threads;

    // 批量条
    if (this.bulkBar) {
      const n = this.selectedIds.size;
      this.bulkBar.style.display = n > 0 ? "flex" : "none";
      if (this.selectedCountEl) this.selectedCountEl.setText(String(n));
    }

    if (filtered.length === 0) {
      const empty = this.listEl.createDiv({ cls: "aite-empty" });
      const ic = empty.createDiv({ cls: "aite-empty-icon" });
      setIcon(ic, "inbox");
      empty.createDiv({ cls: "aite-empty-text", text: filter ? "没有匹配的 thread" : "本 vault 还没有 thread" });
      return;
    }

    for (const t of filtered) this.renderCard(t);
  }

  private renderCard(t: ThreadRow): void {
    if (!this.listEl) return;
    const card = this.listEl.createDiv({ cls: "aite-card" + (t.archived ? " is-archived" : "") + (this.selectedIds.has(t.id) ? " is-selected" : "") });

    // checkbox（右上角，hover 或已选时显示）
    const cb = card.createEl("input", { type: "checkbox", cls: "aite-card-cb", attr: { title: "多选" } });
    cb.checked = this.selectedIds.has(t.id);
    cb.addEventListener("click", (e) => e.stopPropagation());
    cb.addEventListener("change", () => {
      if (cb.checked) this.selectedIds.add(t.id); else this.selectedIds.delete(t.id);
      card.toggleClass("is-selected", cb.checked);
      this.renderList();
    });

    // 名称行
    const nameRow = card.createDiv({ cls: "aite-card-name-row" });
    const nameSpan = nameRow.createDiv({ cls: "aite-card-name" });
    const iconLead = nameSpan.createSpan({ cls: "aite-card-lead" });
    setIcon(iconLead, t.isPluginThread ? "bot" : "message-square");
    nameSpan.createSpan({ text: " " + (t.name || "(未命名)") });

    // 徽章行
    const badges = card.createDiv({ cls: "aite-card-badges" });
    if (t.isPluginThread) badges.createSpan({ cls: "aite-badge b-plugin", text: "插件" });
    if (t.archived) badges.createSpan({ cls: "aite-badge b-archived", text: "已归档" });
    else badges.createSpan({ cls: "aite-badge b-active", text: "活跃" });

    // 笔记路径
    if (t.notePath) {
      const noteEl = card.createDiv({ cls: "aite-card-note" });
      const nIc = noteEl.createSpan({ cls: "aite-card-note-icon" });
      setIcon(nIc, "file-text");
      noteEl.createSpan({ text: " " + t.notePath, cls: "aite-card-note-path" });
    }

    // 底部：时间 + 操作
    const foot = card.createDiv({ cls: "aite-card-foot" });
    const timeEl = foot.createSpan({ cls: "aite-card-time", text: formatRelativeTime(t.updatedAt) });
    timeEl.setAttr("title", new Date(t.updatedAt * 1000).toLocaleString());
    const actions = foot.createDiv({ cls: "aite-card-actions" });

    const mkAct = (icon: string, title: string, danger: boolean, fn: (e: MouseEvent) => void) => {
      const b = actions.createEl("button", { cls: "aite-icon-btn" + (danger ? " danger" : ""), attr: { title } });
      setIcon(b, icon);
      b.addEventListener("click", (e) => { e.stopPropagation(); fn(e); });
      return b;
    };

    mkAct("external-link", t.notePath ? "打开笔记并激活会话" : "激活会话", false, () => this.openAndActivate(t));
    mkAct("pencil", "重命名", false, () => this.showRenamePrompt(t));
    if (t.archived) {
      mkAct("archive-restore", "恢复", false, async () => {
        await this.service.unarchiveThread(t.id);
        new Notice("已恢复：" + (t.name || t.id.substring(0, 8)));
        await this.refresh();
      });
    } else {
      mkAct("archive", "归档", false, async () => {
        await this.service.archiveThread(t.id);
        new Notice("已归档：" + (t.name || t.id.substring(0, 8)));
        await this.refresh();
      });
    }
    mkAct("trash-2", "删除", true, () => this.showDeleteConfirm(t));

    // 整卡片可点击：打开并激活
    card.addEventListener("click", (e) => {
      // 避免与 checkbox / 按钮冲突（它们已 stopPropagation）
      this.openAndActivate(t);
    });
  }

  private async openAndActivate(t: ThreadRow): Promise<void> {
    try {
      const notePath = this.service.getNotePathByThreadId(t.id);
      if (notePath) {
        const file = this.app.vault.getAbstractFileByPath(notePath);
        if (file) {
          await this.app.workspace.openLinkText(notePath, "", false);
          new Notice("已激活：" + notePath);
          return;
        }
        new Notice("笔记文件找不到：" + notePath);
        return;
      }
      // 无关联笔记：直接激活 thread
      await this.service.setActiveThreadById(t.id);
      new Notice("已激活会话");
    } catch (err: any) {
      console.error("[AI Assistant] openAndActivate failed:", err);
      new Notice("❌ 打开失败: " + (err.message || String(err)));
    }
  }

  /** ~/.codex 根目录 */
  private getCodexHome(): string {
    const os = require("os");
    const path = require("path");
    return path.join(os.homedir(), ".codex");
  }

  /** 打开 Codex 的 thread 相关目录 —— 单击默认 sessions，弹菜单可选其他 */
  private revealCodexDir(evt: MouseEvent): void {
    const home = this.getCodexHome();
    const sessions = home + "/sessions";
    // 修饰键：显示子目录选择菜单；否则直接打开 sessions
    if (evt && (evt.shiftKey || evt.altKey || evt.metaKey || evt.ctrlKey)) {
      this.showCodexDirMenu(evt);
      return;
    }
    this.openPath(sessions);
  }

  private showCodexDirMenu(evt: MouseEvent): void {
    const home = this.getCodexHome();
    const sessions = home + "/sessions";
    const archived = home + "/archived_sessions";
    const menu = new Menu();
    menu.addItem((i: any) => i.setTitle("打开 sessions/（活跃 thread）").setIcon("folder-open").onClick(() => this.openPath(sessions)));
    menu.addItem((i: any) => i.setTitle("打开 archived_sessions/（已归档）").setIcon("archive").onClick(() => this.openPath(archived)));
    menu.addItem((i: any) => i.setTitle("打开 ~/.codex 根目录").setIcon("folder").onClick(() => this.openPath(home)));
    menu.showAtMouseEvent(evt);
  }

  /** 系统文件管理器打开（Electron shell.openPath 优先，兜底 child_process） */
  private openPath(p: string): void {
    try {
      const { shell } = require("electron");
      if (shell && typeof shell.openPath === "function") {
        shell.openPath(p).then((err: string) => {
          if (err) {
            console.error("[AI Assistant] openPath failed:", err);
            new Notice("打开目录失败：" + err);
          }
        });
        return;
      }
      const cp = require("child_process");
      const platform = process.platform;
      const cmd = platform === "darwin" ? "open" : platform === "win32" ? "explorer" : "xdg-open";
      cp.spawn(cmd, [p], { detached: true, stdio: "ignore" }).unref();
    } catch (e: any) {
      console.error("[AI Assistant] openPath failed:", e);
      new Notice("无法打开目录：" + (e.message || String(e)));
    }
  }

  private showRenamePrompt(t: ThreadRow): void {
    const modal = new RenameModal(this.app, t.name || "", async (newName) => {
      if (newName && newName !== t.name) {
        try {
          await this.service.renameThread(t.id, newName);
          new Notice("已重命名：" + newName);
          await this.refresh();
        } catch (e: any) {
          console.error("[AI Assistant] rename failed:", e);
          new Notice("重命名失败：" + (e.message || String(e)));
        }
      }
    });
    modal.open();
  }

  private showDeleteConfirm(t: ThreadRow): void {
    new ConfirmModal(this.app, {
      title: "删除 thread",
      body: `确定删除「${t.name || t.id.substring(0, 8)}…」？\n这会从 Codex 桌面版彻底移除，且无法恢复。`,
      okText: "永久删除",
      danger: true,
      onOk: async () => {
        try {
          await this.service.deleteThread(t.id);
          new Notice("已删除");
          await this.refresh();
        } catch (e: any) {
          new Notice("删除失败：" + (e.message || String(e)));
        }
      },
    }).open();
  }

  // ===== 批量操作 =====
  private async bulkArchive(): Promise<void> {
    const ids = [...this.selectedIds];
    if (ids.length === 0) return;
    new ConfirmModal(this.app, {
      title: "批量归档",
      body: `归档 ${ids.length} 个 thread？`,
      okText: "归档",
      danger: false,
      onOk: async () => {
        let ok = 0, fail = 0;
        for (const id of ids) {
          try { await this.service.archiveThread(id); ok++; } catch { fail++; }
        }
        this.selectedIds.clear();
        await this.refresh();
        new Notice(`归档完成：成功 ${ok}，失败 ${fail}`);
      },
    }).open();
  }

  private async bulkUnarchive(): Promise<void> {
    const ids = [...this.selectedIds];
    if (ids.length === 0) return;
    new ConfirmModal(this.app, {
      title: "批量恢复",
      body: `恢复 ${ids.length} 个 thread？`,
      okText: "恢复",
      danger: false,
      onOk: async () => {
        let ok = 0, fail = 0;
        for (const id of ids) {
          try { await this.service.unarchiveThread(id); ok++; } catch { fail++; }
        }
        this.selectedIds.clear();
        await this.refresh();
        new Notice(`恢复完成：成功 ${ok}，失败 ${fail}`);
      },
    }).open();
  }

  private async bulkDelete(): Promise<void> {
    const ids = [...this.selectedIds];
    if (ids.length === 0) return;
    new ConfirmModal(this.app, {
      title: "批量删除",
      body: `⚠️ 永久删除 ${ids.length} 个 thread？\n这会从 Codex 桌面版彻底移除，且无法恢复。`,
      okText: "永久删除",
      danger: true,
      onOk: async () => {
        let ok = 0, fail = 0;
        for (const id of ids) {
          try { await this.service.deleteThread(id); ok++; } catch { fail++; }
        }
        this.selectedIds.clear();
        await this.refresh();
        new Notice(`删除完成：成功 ${ok}，失败 ${fail}`);
      },
    }).open();
  }
}

// ============ 内嵌 Modal ============

class RenameModal extends Modal {
  private currentName: string;
  private onSubmit: (name: string) => void;
  constructor(app: App, currentName: string, onSubmit: (name: string) => void) {
    super(app);
    this.currentName = currentName;
    this.onSubmit = onSubmit;
  }
  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h3", { text: "重命名 thread" });
    const input = contentEl.createEl("input", { type: "text", value: this.currentName });
    input.style.width = "100%";
    input.style.padding = "6px 8px";
    input.style.marginTop = "8px";
    setTimeout(() => { input.focus(); input.select(); }, 50);
    const btnRow = contentEl.createDiv();
    btnRow.style.marginTop = "12px";
    btnRow.style.display = "flex";
    btnRow.style.gap = "8px";
    btnRow.style.justifyContent = "flex-end";
    const cancelBtn = btnRow.createEl("button", { text: "取消" });
    cancelBtn.addEventListener("click", () => this.close());
    const okBtn = btnRow.createEl("button", { text: "确定", cls: "mod-cta" });
    okBtn.addEventListener("click", () => { this.onSubmit(input.value.trim()); this.close(); });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); this.onSubmit(input.value.trim()); this.close(); }
      else if (e.key === "Escape") { this.close(); }
    });
  }
}

interface ConfirmOpts {
  title: string;
  body: string;
  okText: string;
  danger: boolean;
  onOk: () => void | Promise<void>;
}

class ConfirmModal extends Modal {
  private opts: ConfirmOpts;
  constructor(app: App, opts: ConfirmOpts) { super(app); this.opts = opts; }
  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h3", { text: this.opts.title });
    const p = contentEl.createEl("p", { text: this.opts.body });
    p.style.whiteSpace = "pre-wrap";
    p.style.color = "var(--text-muted)";
    p.style.fontSize = "13px";
    const btnRow = contentEl.createDiv();
    btnRow.style.marginTop = "16px";
    btnRow.style.display = "flex";
    btnRow.style.gap = "8px";
    btnRow.style.justifyContent = "flex-end";
    const cancel = btnRow.createEl("button", { text: "取消" });
    cancel.addEventListener("click", () => this.close());
    const ok = btnRow.createEl("button", { text: this.opts.okText, cls: this.opts.danger ? "mod-warning" : "mod-cta" });
    ok.addEventListener("click", async () => { this.close(); await this.opts.onOk(); });
  }
}
