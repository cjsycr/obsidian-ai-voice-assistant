// AssistantView: 右侧栏 ItemView，渲染当前笔记的 AI 助手聊天面板

import { ItemView, WorkspaceLeaf } from "obsidian";
import { ChatPanel } from "./ChatPanel";
import { NoteService } from "../obsidian/NoteService";
import { PluginSettings } from "../types";

export const VIEW_TYPE_ASSISTANT = "ai-voice-assistant-view";

export class AssistantView extends ItemView {
  panel: ChatPanel | null = null;
  private service: NoteService;
  private settings: PluginSettings;
  private getSettings: () => PluginSettings;
  private onOpenThreadsManager: () => void;

  constructor(leaf: WorkspaceLeaf, service: NoteService, settings: PluginSettings, getSettings: () => PluginSettings, onOpenThreadsManager: () => void) {
    super(leaf);
    this.service = service;
    this.settings = settings;
    this.getSettings = getSettings;
    this.onOpenThreadsManager = onOpenThreadsManager;
  }

  getViewType(): string { return VIEW_TYPE_ASSISTANT; }
  getDisplayText(): string { return "AI 助手"; }
  getIcon(): string { return "bot"; }

  async onOpen(): Promise<void> {
    // 用 containerEl 作为根容器，稳妥起见不依赖 children 索引
    const root = this.containerEl;
    root.empty();
    root.addClass("ai-assistant-container");

    try {
      this.panel = new ChatPanel(root, this.service, this.settings, this.getSettings, this.onOpenThreadsManager);
      this.panel.render();
    } catch (e: any) {
      root.createEl("div", {
        cls: "ai-assistant-error-detail",
        text: `渲染错误：${e.message}\n${e.stack || ""}`,
      });
      console.error("[AI Assistant] render error", e);
    }
  }

  async onClose(): Promise<void> {
    this.panel?.destroy();
    this.panel = null;
  }
}
