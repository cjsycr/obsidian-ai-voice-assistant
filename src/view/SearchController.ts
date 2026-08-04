// 对话内搜索 —— 从 ChatPanel 抽出的独立控制器
// 负责：搜索条 DOM、命中高亮、上下跳转、大小写敏感切换

export class SearchController {
  private barEl: HTMLElement;
  private inputEl!: HTMLInputElement;
  private countEl!: HTMLElement;
  private caseBtn!: HTMLElement;
  private messagesEl: HTMLElement;
  private hits: HTMLElement[] = [];
  private currentHit = 0;
  private isOpen = false;
  private onToggle: (open: boolean) => void;

  constructor(parent: HTMLElement, messagesEl: HTMLElement, onToggle: (open: boolean) => void) {
    this.messagesEl = messagesEl;
    this.onToggle = onToggle;
    this.barEl = parent.createDiv({ cls: "ai-assistant-search-bar" });
    this.barEl.style.display = "none";
    this.build();
  }

  private build(): void {
    this.inputEl = this.barEl.createEl("input", {
      type: "text",
      cls: "ai-assistant-search-input",
      attr: { placeholder: "搜索对话…" },
    });
    this.inputEl.addEventListener("input", () => this.doSearch());
    this.inputEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); this.nav(e.shiftKey ? -1 : 1); }
      else if (e.key === "Escape") { e.preventDefault(); this.toggle(false); }
    });
    this.caseBtn = this.barEl.createEl("button", {
      cls: "ai-assistant-search-case",
      text: "Aa",
      attr: { title: "区分大小写" },
    });
    this.caseBtn.addEventListener("click", () => {
      this.caseBtn.classList.toggle("is-active");
      this.doSearch();
    });
    this.countEl = this.barEl.createDiv({ cls: "ai-assistant-search-count" });
    // SAFE: 静态标签
    this.countEl.innerHTML = "<b>0</b>/0";
    const prev = this.barEl.createEl("button", { cls: "ai-assistant-search-nav", text: "↑", attr: { title: "上一个 (Shift+Enter)" } });
    prev.addEventListener("click", () => this.nav(-1));
    const next = this.barEl.createEl("button", { cls: "ai-assistant-search-nav", text: "↓", attr: { title: "下一个 (Enter)" } });
    next.addEventListener("click", () => this.nav(1));
    const close = this.barEl.createEl("button", { cls: "ai-assistant-search-close", text: "✕", attr: { title: "关闭 (Esc)" } });
    close.addEventListener("click", () => this.toggle(false));
  }

  toggle(forceOpen?: boolean): void {
    const open = forceOpen !== undefined ? forceOpen : !this.isOpen;
    this.isOpen = open;
    this.barEl.style.display = open ? "flex" : "none";
    if (open) {
      this.inputEl.focus();
      this.inputEl.select();
      this.doSearch();
    } else {
      this.clearHighlights();
    }
    this.onToggle(open);
  }

  clearHighlights(): void {
    this.messagesEl.querySelectorAll("mark.ai-search-hit").forEach((m) => {
      const parent = m.parentNode;
      if (!parent) return;
      while (m.firstChild) parent.insertBefore(m.firstChild, m);
      parent.removeChild(m);
      parent.normalize();
    });
    this.hits = [];
    this.currentHit = 0;
    this.countEl.innerHTML = "<b>0</b>/0";
  }

  private doSearch(): void {
    this.clearHighlights();
    const q = this.inputEl.value.trim();
    if (!q) return;
    const cs = this.caseBtn.classList.contains("is-active");
    const re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), cs ? "g" : "gi");
    const bodies = this.messagesEl.querySelectorAll<HTMLElement>(".ai-msg-body");
    bodies.forEach(b => this.walk(b, re));
    this.hits = Array.from(this.messagesEl.querySelectorAll<HTMLElement>("mark.ai-search-hit"));
    this.currentHit = 0;
    if (this.hits.length) this.markActive();
  }

  private walk(node: Node, re: RegExp): void {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent || "";
      re.lastIndex = 0;
      if (!re.test(text)) return;
      re.lastIndex = 0;
      const frag = document.createDocumentFragment();
      let last = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(text)) !== null) {
        if (m.index > last) frag.appendChild(document.createTextNode(text.slice(last, m.index)));
        const mark = document.createElement("mark");
        mark.className = "ai-search-hit";
        mark.textContent = m[0];
        frag.appendChild(mark);
        last = m.index + m[0].length;
        if (m.index === re.lastIndex) re.lastIndex++;
      }
      if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
      node.parentNode?.replaceChild(frag, node);
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const tag = (node as HTMLElement).tagName;
      if (tag === "MARK" || tag === "SCRIPT" || tag === "STYLE") return;
      Array.from(node.childNodes).forEach(n => this.walk(n, re));
    }
  }

  private markActive(): void {
    if (!this.hits.length) return;
    this.hits.forEach(h => h.classList.remove("is-active"));
    const hit = this.hits[this.currentHit];
    hit.classList.add("is-active");
    hit.scrollIntoView({ block: "center", behavior: "smooth" });
    // SAFE: 只拼接数字，非用户字符串
    this.countEl.innerHTML = "<b>" + (this.currentHit + 1) + "</b>/" + this.hits.length;
  }

  private nav(dir: number): void {
    if (!this.hits.length) return;
    this.currentHit = (this.currentHit + dir + this.hits.length) % this.hits.length;
    this.markActive();
  }
}
