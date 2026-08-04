// 首启动引导 tour —— 4 页浮层，介绍 @/ / ⌘F / 多选 / Threads 管理器
// 用法：openTour({ onFinish: () => saveSettings() })

import { setIcon } from "obsidian";

export interface TourStep {
  icon: string;      // lucide icon 名
  title: string;
  body: string;
  kbd?: string;      // 可选的键位提示
}

export interface TourOptions {
  onFinish: () => void;
  steps?: TourStep[];
}

export const DEFAULT_TOUR_STEPS: TourStep[] = [
  {
    icon: "sparkles",
    title: "欢迎使用 AI Whispers",
    body: "由 Codex 驱动的 Obsidian AI 助手。它会自动感知你正在读的笔记，一笔记绑定一段对话。\n\n下面几页快速介绍核心功能，30 秒读完。",
  },
  {
    icon: "at-sign",
    title: "用 @ 引用其他笔记",
    body: "在输入框直接敲 @，会浮出补全列表 —— 边打字边过滤，↑↓ 选择，Enter 确认，会把 @路径 插入到当前输入。\n\n工具栏的 @ 按钮效果一样。",
    kbd: "@",
  },
  {
    icon: "slash",
    title: "用 / 调用预设指令",
    body: "输入框敲 /，会浮出斜杠指令面板（总结、翻译、润色、代码 review …）。可以在设置里增删自定义。\n\n模板里可写 {{selection}} {{note-title}} {{date}} 等变量，发送前会自动替换。",
    kbd: "/",
  },
  {
    icon: "search",
    title: "对话内搜索 & 多选导出",
    body: "⌘F / Ctrl+F 在当前对话里搜索关键词。\n\n右上「多选」按钮进入选择模式，选中若干消息可批量复制 / 导出为 Markdown 文件。",
    kbd: "⌘ F",
  },
  {
    icon: "coffee",
    title: "支持一下作者？",
    body: "如果这个插件对你有帮助，欢迎在爱发电请我喝杯咖啡 ☕，能让更新持续得更久。\n\n爱发电：https://www.ifdian.net/a/cjsycr\n\n感谢使用，关闭引导后随时可以从设置页 → ❤️ 支持 进入。",
  },
];

export function openTour(opts: TourOptions): void {
  const steps = opts.steps || DEFAULT_TOUR_STEPS;
  let index = 0;

  const overlay = document.body.createDiv({ cls: "ai-tour-overlay" });
  const card = overlay.createDiv({ cls: "ai-tour-card" });

  const iconWrap = card.createDiv({ cls: "ai-tour-icon" });
  const titleEl = card.createEl("h2", { cls: "ai-tour-title" });
  const kbdWrap = card.createDiv({ cls: "ai-tour-kbd-wrap" });
  const bodyEl = card.createEl("p", { cls: "ai-tour-body" });
  bodyEl.style.whiteSpace = "pre-wrap";

  // 进度点
  const dots = card.createDiv({ cls: "ai-tour-dots" });
  for (let i = 0; i < steps.length; i++) {
    const d = dots.createDiv({ cls: "ai-tour-dot" });
    d.addEventListener("click", () => { index = i; render(); });
  }

  // 按钮栏
  const footer = card.createDiv({ cls: "ai-tour-footer" });
  const skipBtn = footer.createEl("button", { cls: "ai-tour-btn ai-tour-btn-ghost", text: "跳过引导" });
  footer.createDiv({ cls: "ai-tour-spacer" });
  const prevBtn = footer.createEl("button", { cls: "ai-tour-btn ai-tour-btn-ghost", text: "上一步" });
  const nextBtn = footer.createEl("button", { cls: "ai-tour-btn ai-tour-btn-primary" });

  const finish = () => {
    overlay.remove();
    document.removeEventListener("keydown", onKey);
    opts.onFinish();
  };

  const render = () => {
    const s = steps[index];
    iconWrap.empty();
    setIcon(iconWrap, s.icon);
    titleEl.setText(s.title);
    bodyEl.setText(s.body);
    kbdWrap.empty();
    if (s.kbd) {
      const parts = s.kbd.split(" ").filter(x => x);
      for (const p of parts) {
        kbdWrap.createEl("kbd", { text: p });
      }
    }
    for (let i = 0; i < steps.length; i++) {
      const el = dots.children[i] as HTMLElement;
      el.classList.toggle("is-active", i === index);
    }
    prevBtn.disabled = index === 0;
    nextBtn.setText(index === steps.length - 1 ? "开始使用 ✓" : "下一步 →");
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") { e.preventDefault(); finish(); }
    else if (e.key === "ArrowRight" || e.key === "Enter") {
      e.preventDefault();
      if (index < steps.length - 1) { index++; render(); }
      else finish();
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      if (index > 0) { index--; render(); }
    }
  };

  skipBtn.addEventListener("click", finish);
  prevBtn.addEventListener("click", () => { if (index > 0) { index--; render(); } });
  nextBtn.addEventListener("click", () => {
    if (index < steps.length - 1) { index++; render(); }
    else finish();
  });
  overlay.addEventListener("click", (e) => { if (e.target === overlay) finish(); });
  document.addEventListener("keydown", onKey);

  render();
}
