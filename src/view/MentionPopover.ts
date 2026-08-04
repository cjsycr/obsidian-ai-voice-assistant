// @ 引用就地补全 —— Cursor / Slack 风的 mention popover
// 挂在 input 元素下方，随查询关键词实时过滤 vault 里的笔记
// 键盘：↑↓ 移动，Enter/Tab 选中，Esc 关闭

import { App, TFile } from "obsidian";

export interface MentionPopoverOptions {
  app: App;
  inputEl: HTMLTextAreaElement;
  /** @ 在输入框中的位置（selectionStart 位置，用来插入选中结果 & 追踪查询词） */
  triggerAt: number;
  /** 用户选中某个文件；null 表示 Esc 取消 */
  onPick: (file: TFile | null) => void;
}

export interface MentionPopoverHandle {
  close: () => void;
  isOpen: () => boolean;
}

export function openMentionPopover(opts: MentionPopoverOptions): MentionPopoverHandle {
  const { app, inputEl, triggerAt, onPick } = opts;
  let closed = false;
  const files = app.vault.getMarkdownFiles();

  // === 构建浮层 ===
  const pop = document.body.createDiv({ cls: "ai-mention-popover" });
  pop.style.position = "fixed";
  pop.style.zIndex = "1000";
  const listEl = pop.createDiv({ cls: "ai-mention-list" });

  // 使用 caret 坐标计算 popover 位置
  const positionPopover = () => {
    const rect = inputEl.getBoundingClientRect();
    // 简单方案：贴在输入框正上方（对话面板输入框在底部 → 向上弹更符合直觉）
    // 若空间不够则改到下方
    const popH = Math.min(280, pop.offsetHeight || 220);
    const spaceAbove = rect.top;
    const spaceBelow = window.innerHeight - rect.bottom;
    const showAbove = spaceAbove >= popH + 8 || spaceAbove > spaceBelow;
    if (showAbove) {
      pop.style.top = Math.max(8, rect.top - popH - 6) + "px";
    } else {
      pop.style.top = (rect.bottom + 6) + "px";
    }
    pop.style.left = Math.max(8, rect.left) + "px";
    pop.style.width = Math.min(rect.width, 420) + "px";
  };

  let currentQuery = "";
  let highlightIndex = 0;
  let filtered: TFile[] = [];

  const scoreFile = (f: TFile, q: string): number => {
    if (!q) return 1;
    const path = f.path.toLowerCase();
    const name = f.basename.toLowerCase();
    const ql = q.toLowerCase();
    if (name === ql) return 1000;
    if (name.startsWith(ql)) return 800;
    if (name.includes(ql)) return 500;
    if (path.includes(ql)) return 200;
    // 分散字符匹配（fuzzy 简化版：所有字符按顺序出现在 path 中）
    let i = 0;
    for (const c of ql) {
      const idx = path.indexOf(c, i);
      if (idx === -1) return 0;
      i = idx + 1;
    }
    return 50;
  };

  const highlightMatch = (text: string, q: string, target: HTMLElement) => {
    if (!q) { target.appendText(text); return; }
    const idx = text.toLowerCase().indexOf(q.toLowerCase());
    if (idx === -1) { target.appendText(text); return; }
    target.appendText(text.slice(0, idx));
    target.createSpan({ cls: "ai-mention-hl", text: text.slice(idx, idx + q.length) });
    target.appendText(text.slice(idx + q.length));
  };

  const renderList = () => {
    listEl.empty();
    filtered = files
      .map(f => ({ f, s: scoreFile(f, currentQuery) }))
      .filter(x => x.s > 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, 12)
      .map(x => x.f);

    if (filtered.length === 0) {
      listEl.createDiv({ cls: "ai-mention-empty", text: "没有匹配的笔记" });
      return;
    }
    if (highlightIndex >= filtered.length) highlightIndex = filtered.length - 1;
    if (highlightIndex < 0) highlightIndex = 0;

    for (let i = 0; i < filtered.length; i++) {
      const f = filtered[i];
      const item = listEl.createDiv({ cls: "ai-mention-item" + (i === highlightIndex ? " is-active" : "") });
      const nameEl = item.createDiv({ cls: "ai-mention-name" });
      highlightMatch(f.basename, currentQuery, nameEl);
      const pathEl = item.createDiv({ cls: "ai-mention-path" });
      highlightMatch(f.parent?.path || "/", currentQuery, pathEl);
      item.addEventListener("mouseenter", () => {
        highlightIndex = i;
        // 只切换 class，不完全重建
        for (const el of listEl.querySelectorAll(".ai-mention-item")) el.classList.remove("is-active");
        item.classList.add("is-active");
      });
      item.addEventListener("mousedown", (e) => {
        // mousedown 而非 click：避免 focus 从 input 转走导致 blur 提前关闭
        e.preventDefault();
        pick(f);
      });
    }
    positionPopover();
  };

  // 从当前 input 值中，抽取 @ 到光标之间的查询词
  const readQueryFromInput = (): string | null => {
    const val = inputEl.value;
    const caret = inputEl.selectionStart ?? val.length;
    // 有效前提：triggerAt 位置仍是 @
    if (val.charAt(triggerAt) !== "@") return null;
    if (caret < triggerAt + 1) return null; // 光标跑到 @ 前面
    const q = val.slice(triggerAt + 1, caret);
    // 查询词里出现空格 / 换行，认为用户不再想触发补全 → 关闭
    if (/[\s\n]/.test(q)) return null;
    return q;
  };

  const pick = (file: TFile | null) => {
    if (closed) return;
    closed = true;
    cleanup();
    onPick(file);
  };

  const onKeydown = (e: KeyboardEvent) => {
    if (closed) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      highlightIndex = (highlightIndex + 1) % filtered.length;
      renderList();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      highlightIndex = (highlightIndex - 1 + filtered.length) % filtered.length;
      renderList();
    } else if (e.key === "Enter" || e.key === "Tab") {
      if (filtered.length > 0) {
        e.preventDefault();
        e.stopPropagation();
        pick(filtered[highlightIndex]);
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      pick(null);
    }
  };

  const onInput = () => {
    const q = readQueryFromInput();
    if (q === null) {
      // 光标离开了 @…word 区域 → 关闭 popover（保留 @ 字符本身）
      pick(null);
      return;
    }
    if (q !== currentQuery) {
      currentQuery = q;
      highlightIndex = 0;
      renderList();
    }
  };

  const onBlur = () => {
    // 延迟关闭，让 mousedown 有机会先触发 pick
    setTimeout(() => { if (!closed) pick(null); }, 120);
  };

  const onReposition = () => positionPopover();

  const cleanup = () => {
    inputEl.removeEventListener("keydown", onKeydown, true);
    inputEl.removeEventListener("input", onInput);
    inputEl.removeEventListener("blur", onBlur);
    window.removeEventListener("resize", onReposition);
    window.removeEventListener("scroll", onReposition, true);
    pop.remove();
  };

  // 捕获阶段监听 keydown，抢在 textarea 的 Enter=换行前处理
  inputEl.addEventListener("keydown", onKeydown, true);
  inputEl.addEventListener("input", onInput);
  inputEl.addEventListener("blur", onBlur);
  window.addEventListener("resize", onReposition);
  window.addEventListener("scroll", onReposition, true);

  currentQuery = readQueryFromInput() || "";
  renderList();
  positionPopover();

  return {
    close: () => pick(null),
    isOpen: () => !closed,
  };
}
