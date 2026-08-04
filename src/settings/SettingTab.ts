// 设置面板 — 分组 Tabs 版

import { App, PluginSettingTab, Setting, Notice } from "obsidian";
import AIVoiceAssistantPlugin from "../main";
import { getVaultBasePath } from "../utils/vault";

type TabKey = "general" | "appearance" | "conversation" | "quick" | "slash" | "export" | "repos" | "support";

interface TabDef {
  key: TabKey;
  icon: string;
  label: string;
}

const TABS: TabDef[] = [
  { key: "general",      icon: "🧭", label: "常规" },
  { key: "appearance",   icon: "🎨", label: "外观" },
  { key: "conversation", icon: "💬", label: "对话" },
  { key: "quick",        icon: "⚡", label: "快捷指令" },
  { key: "slash",        icon: "/",  label: "斜杠指令" },
  { key: "export",       icon: "📤", label: "导出" },
  { key: "repos",        icon: "🗂", label: "仓库" },
  { key: "support",      icon: "❤️", label: "支持" },
];

export class AIVoiceSettingTab extends PluginSettingTab {
  plugin: AIVoiceAssistantPlugin;
  private activeTab: TabKey = "general";
  private tabsBarEl: HTMLElement | null = null;
  private bodyEl: HTMLElement | null = null;

  constructor(app: App, plugin: AIVoiceAssistantPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.addClass("ai-settings-root");

    // 头部
    const header = containerEl.createDiv({ cls: "ai-settings-header" });
    header.createEl("h2", { text: "AI Whispers · AI 耳语者" });
    header.createEl("p", {
      text: "此插件通过 Codex app-server 协议连接到本机 Codex。Codex CLI 必须已安装并登录。",
      cls: "setting-item-description",
    });

    // Tabs 栏（顶部横向）
    this.tabsBarEl = containerEl.createDiv({ cls: "ai-settings-tabs" });
    this.renderTabs();

    // 内容区
    this.bodyEl = containerEl.createDiv({ cls: "ai-settings-body" });
    this.renderBody();
  }

  private renderTabs(): void {
    if (!this.tabsBarEl) return;
    this.tabsBarEl.empty();
    for (const t of TABS) {
      const btn = this.tabsBarEl.createEl("button", { cls: "ai-settings-tab-btn" });
      if (t.key === this.activeTab) btn.addClass("is-active");
      const icon = btn.createSpan({ cls: "ai-settings-tab-icon", text: t.icon });
      btn.createSpan({ cls: "ai-settings-tab-label", text: " " + t.label });
      // badge：动态数量
      const badgeCount = this.tabBadge(t.key);
      if (badgeCount !== null) {
        btn.createSpan({ cls: "ai-settings-tab-badge", text: String(badgeCount) });
      }
      btn.addEventListener("click", () => {
        this.activeTab = t.key;
        this.renderTabs();
        this.renderBody();
      });
      void icon; // no-op
    }
  }

  private tabBadge(key: TabKey): number | string | null {
    if (key === "quick") return (this.plugin.settings.quickPrompts || []).length;
    if (key === "slash") return (this.plugin.settings.slashCommands || []).length;
    if (key === "support") return "❤️";
    return null;
  }

  private renderBody(): void {
    if (!this.bodyEl) return;
    this.bodyEl.empty();
    switch (this.activeTab) {
      case "general":      this.renderGeneral(this.bodyEl); break;
      case "appearance":   this.renderAppearance(this.bodyEl); break;
      case "conversation": this.renderConversation(this.bodyEl); break;
      case "quick":        this.renderQuick(this.bodyEl); break;
      case "slash":        this.renderSlash(this.bodyEl); break;
      case "export":       this.renderExport(this.bodyEl); break;
      case "repos":        this.renderRepos(this.bodyEl); break;
      case "support":      this.renderSupport(this.bodyEl); break;
    }
  }

  // ============ 常规 ============
  private renderGeneral(el: HTMLElement): void {
    new Setting(el)
      .setName("连接状态")
      .setDesc(this.plugin.client?.isConnected() ? "✅ 已连接" : "❌ 未连接")
      .addButton(btn => btn
        .setButtonText("重启 Codex")
        .onClick(async () => {
          await this.plugin.restartCodex();
          this.renderBody();
          this.renderTabs();
        }));

    new Setting(el)
      .setName("Codex CLI 路径")
      .setDesc("默认 'codex'。如果不在 PATH 里，写绝对路径。")
      .addText(text => text
        .setPlaceholder("codex")
        .setValue(this.plugin.settings.codexPath)
        .onChange(async (value) => {
          this.plugin.settings.codexPath = value;
          await this.plugin.saveAll();
        }));

    new Setting(el)
      .setName("模型")
      .setDesc("留空则跟随全局 config.toml 配置（推荐）。填写则覆盖全局设置。")
      .addText(text => text
        .setValue(this.plugin.settings.model)
        .onChange(async (value) => {
          this.plugin.settings.model = value;
          await this.plugin.saveAll();
        }));

    new Setting(el)
      .setName("模型 Provider")
      .setDesc("留空则跟随全局 config.toml 配置（推荐）。填写则覆盖全局设置。")
      .addText(text => text
        .setValue(this.plugin.settings.modelProvider)
        .onChange(async (value) => {
          this.plugin.settings.modelProvider = value;
          await this.plugin.saveAll();
        }));

    new Setting(el)
      .setName("Thread 标题前缀")
      .setDesc("在 Codex 桌面版里用这个前缀标识 AI 助手的工作（例如 📓 daily/xxx.md）。")
      .addText(text => text
        .setValue(this.plugin.settings.threadNamePrefix)
        .setPlaceholder("📓 ")
        .onChange(async (value) => {
          this.plugin.settings.threadNamePrefix = value;
          await this.plugin.saveAll();
        }));

    new Setting(el)
      .setName("重新播放首次引导")
      .setDesc("再次显示欢迎教程（介绍 @ 引用 / 斜杠指令 / ⌘F / 多选 / Threads 管理器）")
      .addButton(btn => btn
        .setButtonText("播放")
        .onClick(() => this.plugin.startTour()));

    // === 危险操作分隔线 ===
    el.createEl("h3", { text: "⚠️ 危险区" }).style.cssText = "margin-top:24px;color:var(--text-error);font-size:13px;";
    el.createDiv({ cls: "setting-item-description", text: "以下操作不可撤销。仅清理本插件通过一笔记一线程创建的 threads，不会影响你在 Codex 桌面版单独创建的对话。" });

    new Setting(el)
      .setName("清空本插件创建的所有 threads")
      .setDesc("彻底删除本插件为每条笔记建立的所有 Codex thread（历史对话全部消失）。适合想推倒重来或清理长期堆积的场景。")
      .addButton(btn => btn
        .setButtonText("清空…")
        .setWarning()
        .onClick(async () => {
          const count = Object.keys(this.plugin.getThreadMap() || {}).length;
          if (count === 0) {
            new (require("obsidian").Notice)("目前没有本插件创建的 thread 需要清理。");
            return;
          }
          const ok1 = confirm(`确认清空 ${count} 个 thread？\n\n这将删除本插件为每条笔记建立的对话历史。\n此操作不可撤销。`);
          if (!ok1) return;
          const ok2 = confirm("再次确认：真的要删除所有历史吗？\n\n（Codex 桌面版里的这些 thread 也会一并消失）");
          if (!ok2) return;
          try {
            const { deleted, failed } = await this.plugin.service.purgePluginThreads();
            new (require("obsidian").Notice)(
              `✅ 已清空 ${deleted} 个 thread${failed > 0 ? `（${failed} 个失败，可能已不存在）` : ""}。`,
              5000
            );
            this.plugin.refreshAllViews();
          } catch (e: any) {
            new (require("obsidian").Notice)("清空失败：" + (e?.message || String(e)), 5000);
          }
        }));
  }

  // ============ 外观 ============
  private renderAppearance(el: HTMLElement): void {
    new Setting(el)
      .setName("消息字体大小")
      .setDesc("聊天消息显示的字号（10-20 px）")
      .addSlider(slider => slider
        .setLimits(10, 20, 1)
        .setValue(this.plugin.settings.messageFontSize)
        .setDynamicTooltip()
        .onChange(async (value) => {
          this.plugin.settings.messageFontSize = value;
          await this.plugin.saveAll();
          this.plugin.refreshAllViews();
        }));
  }

  // ============ 对话 ============
  private renderConversation(el: HTMLElement): void {
    new Setting(el)
      .setName("思考过程默认折叠")
      .setDesc("开启后，AI 的思考过程默认收起，点击可展开。⚠️ 仅推理模型（gpt-5 / o1 / o3 / ark-code-latest 等）会产生思考过程；MiniMax-M3 / gpt-4o 等普通模型不产生 reasoning。")
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.reasoningDefaultCollapsed)
        .onChange(async (value) => {
          this.plugin.settings.reasoningDefaultCollapsed = value;
          await this.plugin.saveAll();
        }));

    new Setting(el)
      .setName("底部状态栏上下文用量")
      .setDesc("在 Obsidian 底部状态栏显示当前对话的上下文用量估算进度条和执行状态。需要重启 Obsidian 或重新加载插件生效。")
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.showStatusBar)
        .onChange(async (value) => {
          this.plugin.settings.showStatusBar = value;
          await this.plugin.saveAll();
          // 通知 main.ts 重新创建/销毁状态栏
          this.plugin.toggleStatusBar(value);
        }));

    el.createEl("h3", { text: "前置提示词（自定义指令）" });
    el.createEl("p", { cls: "setting-item-description", text: "为 AI 设置基础指令。每次创建 thread 都会带上。" });
    new Setting(el)
      .setName("自定义指令")
      .setDesc("支持多行，留空则用默认。")
      .addTextArea(text => {
        text
          .setPlaceholder("例如：\n1. 回答前先问需不需要备份\n2. 备份到 /path/to/notes-backup/")
          .setValue(this.plugin.settings.customInstructions || "")
          .onChange(async (value) => {
            this.plugin.settings.customInstructions = value;
            await this.plugin.saveAll();
          });
        text.inputEl.rows = 8;
        text.inputEl.style.width = "100%";
        return text;
      });
  }

  // ============ 快捷指令 ============
  private renderQuick(el: HTMLElement): void {
    el.createDiv({ cls: "setting-item-description", text: "显示在输入框左下角的胶囊按钮。点击后会把 prompt 追加到输入框（不会立刻发送）。" });
    el.createDiv({ cls: "setting-item-description", text: "支持变量（发送前自动替换）：{{selection}} · {{note-title}} · {{note-path}} · {{note-content}} · {{date}} · {{time}} · {{clipboard}}" });

    const qpContainer = el.createDiv({ cls: "ai-settings-list" });
    const renderList = () => {
      qpContainer.empty();
      const list = this.plugin.settings.quickPrompts || [];
      list.forEach((qp, idx) => {
        const row = qpContainer.createDiv({ cls: "ai-settings-list-row" });
        const nameIn = row.createEl("input", { type: "text", value: qp.name, cls: "ai-settings-input", attr: { placeholder: "显示名 (含 emoji)" } });
        nameIn.style.flex = "0 0 140px";
        const promptIn = row.createEl("input", { type: "text", value: qp.prompt, cls: "ai-settings-input", attr: { placeholder: "prompt 内容" } });
        promptIn.style.flex = "1";
        const save = () => {
          this.plugin.settings.quickPrompts[idx] = { name: nameIn.value, prompt: promptIn.value };
          this.plugin.saveAll().then(() => this.plugin.refreshChatPanel());
        };
        nameIn.addEventListener("change", save);
        promptIn.addEventListener("change", save);
        const del = row.createEl("button", { text: "✕", cls: "ai-settings-del-btn" });
        del.addEventListener("click", async () => {
          this.plugin.settings.quickPrompts.splice(idx, 1);
          await this.plugin.saveAll();
          this.plugin.refreshChatPanel();
          renderList();
          this.renderTabs();
        });
      });
    };
    renderList();

    new Setting(el)
      .addButton(btn => btn.setButtonText("+ 添加快捷指令").onClick(async () => {
        if (!Array.isArray(this.plugin.settings.quickPrompts)) this.plugin.settings.quickPrompts = [];
        this.plugin.settings.quickPrompts.push({ name: "🆕 新指令", prompt: "" });
        await this.plugin.saveAll();
        this.plugin.refreshChatPanel();
        renderList();
        this.renderTabs();
      }))
      .addButton(btn => btn.setButtonText("恢复默认").setWarning().onClick(async () => {
        if (!confirm("恢复到默认的 5 个快捷指令？当前配置会被覆盖")) return;
        const { DEFAULT_SETTINGS } = await import("../types");
        this.plugin.settings.quickPrompts = JSON.parse(JSON.stringify(DEFAULT_SETTINGS.quickPrompts));
        await this.plugin.saveAll();
        this.plugin.refreshChatPanel();
        renderList();
        this.renderTabs();
      }));
  }

  // ============ 斜杠指令 ============
  private renderSlash(el: HTMLElement): void {
    el.createDiv({ cls: "setting-item-description", text: "在发送按钮旁的 / 按钮弹出面板中选择。空输入框按 / 键也能唤出。" });
    el.createDiv({ cls: "setting-item-description", text: "prompt 支持变量：{{selection}} · {{note-title}} · {{note-path}} · {{note-content}} · {{date}} · {{time}} · {{clipboard}}" });

    const scContainer = el.createDiv({ cls: "ai-settings-list" });
    const renderList = () => {
      scContainer.empty();
      const list = this.plugin.settings.slashCommands || [];
      list.forEach((sc, idx) => {
        const row = scContainer.createDiv({ cls: "ai-settings-list-row ai-settings-list-row-slash" });
        const triggerIn = row.createEl("input", { type: "text", value: sc.trigger, cls: "ai-settings-input", attr: { placeholder: "trigger（英文）" } });
        triggerIn.style.flex = "0 0 100px";
        const nameIn = row.createEl("input", { type: "text", value: sc.name, cls: "ai-settings-input", attr: { placeholder: "显示名" } });
        nameIn.style.flex = "0 0 130px";
        const catIn = row.createEl("input", { type: "text", value: sc.category || "", cls: "ai-settings-input", attr: { placeholder: "分类" } });
        catIn.style.flex = "0 0 70px";
        const descIn = row.createEl("input", { type: "text", value: sc.description, cls: "ai-settings-input", attr: { placeholder: "说明" } });
        descIn.style.flex = "1";
        const promptIn = row.createEl("input", { type: "text", value: sc.prompt, cls: "ai-settings-input", attr: { placeholder: "prompt" } });
        promptIn.style.flex = "1 1 100%";
        const save = () => {
          this.plugin.settings.slashCommands[idx] = {
            trigger: triggerIn.value.trim(),
            name: nameIn.value,
            category: catIn.value.trim() || undefined,
            description: descIn.value,
            prompt: promptIn.value,
            icon: sc.icon,
          };
          this.plugin.saveAll();
        };
        [triggerIn, nameIn, catIn, descIn, promptIn].forEach(inp => inp.addEventListener("change", save));
        const del = row.createEl("button", { text: "✕", cls: "ai-settings-del-btn" });
        del.addEventListener("click", async () => {
          this.plugin.settings.slashCommands.splice(idx, 1);
          await this.plugin.saveAll();
          renderList();
          this.renderTabs();
        });
      });
    };
    renderList();

    new Setting(el)
      .addButton(btn => btn.setButtonText("+ 添加斜杠指令").onClick(async () => {
        if (!Array.isArray(this.plugin.settings.slashCommands)) this.plugin.settings.slashCommands = [];
        this.plugin.settings.slashCommands.push({ trigger: "new-cmd", name: "新指令", description: "", prompt: "", category: "通用" });
        await this.plugin.saveAll();
        renderList();
        this.renderTabs();
      }))
      .addButton(btn => btn.setButtonText("恢复默认").setWarning().onClick(async () => {
        if (!confirm("恢复到默认的斜杠指令？当前配置会被覆盖")) return;
        const { DEFAULT_SETTINGS } = await import("../types");
        this.plugin.settings.slashCommands = JSON.parse(JSON.stringify(DEFAULT_SETTINGS.slashCommands));
        await this.plugin.saveAll();
        renderList();
        this.renderTabs();
      }));
  }

  // ============ 导出 ============
  private renderExport(el: HTMLElement): void {
    el.createEl("p", { cls: "setting-item-description", text: '当多选消息并点击 📦 导出时，导出的 Markdown 文件保存到此文件夹（相对 vault 根目录）。留空或 "/" 表示 vault 根目录。' });

    new Setting(el)
      .setName("导出文件夹")
      .setDesc("默认 exports/。例如：exports/codex 表示 vault/exports/codex/")
      .addText(text => text
        .setPlaceholder("exports")
        .setValue(this.plugin.settings.exportFolder || "exports")
        .onChange(async (value) => {
          this.plugin.settings.exportFolder = value;
          await this.plugin.saveAll();
          this.renderBody();
        }));

    const exportAbs = getVaultBasePath(this.plugin.app) + "/" + (this.plugin.settings.exportFolder || "exports");
    new Setting(el)
      .setName("导出路径预览")
      .setDesc("下次导出将保存到：" + exportAbs + "/codex-export-YYYY-MM-DD-<note>.md")
      .addButton(btn => btn
        .setButtonText("📂 打开导出文件夹")
        .onClick(async () => {
          try {
            const adapter = this.plugin.app.vault.adapter as any;
            if (adapter && typeof adapter.mkdir === "function") {
              try { await adapter.mkdir(exportAbs); } catch {}
            }
            const electron = require("electron");
            const shell = electron?.shell;
            if (shell && shell.openPath) {
              shell.openPath(exportAbs);
              new Notice("已打开：" + exportAbs);
            } else {
              new Notice("导出路径：" + exportAbs);
            }
          } catch (e) {
            new Notice("无法打开文件夹：" + String(e));
          }
        }));
  }

  // ============ 仓库 ============
  private renderRepos(el: HTMLElement): void {
    el.createEl("p", { cls: "setting-item-description", text: "告诉 AI 你有哪些本地仓库（比如 vault 之外的工作目录）。AI 会直接去这些路径找内容，不用搜索整个电脑。每行一个，格式：名称:路径（例：工作笔记:/path/to/Work）" });

    const reposContainer = el.createDiv();
    const renderList = () => {
      reposContainer.empty();
      const repos = this.plugin.settings.repoLocations || [];
      if (repos.length === 0) {
        reposContainer.createEl("p", { text: "（暂无）", cls: "setting-item-description" });
        return;
      }
      repos.forEach((repo, idx) => {
        new Setting(reposContainer)
          .setName(repo.name || "(未命名)")
          .setDesc(repo.path)
          .addButton(btn => btn
            .setButtonText("删除")
            .setWarning()
            .onClick(async () => {
              this.plugin.settings.repoLocations.splice(idx, 1);
              await this.plugin.saveAll();
              renderList();
            }));
      });
    };
    renderList();

    const newNameInput = el.createEl("input", { type: "text", placeholder: "名称" });
    newNameInput.style.marginBottom = "8px";
    newNameInput.style.width = "100%";
    const newPathInput = el.createEl("input", { type: "text", placeholder: "路径（绝对路径，如 /path/to/Work）" });
    newPathInput.style.marginBottom = "8px";
    newPathInput.style.width = "100%";

    new Setting(el)
      .addButton(btn => btn
        .setButtonText("添加仓库")
        .onClick(async () => {
          const n = newNameInput.value.trim();
          const p = newPathInput.value.trim();
          if (!n || !p) { new Notice("请填写名称和路径"); return; }
          if (!this.plugin.settings.repoLocations) this.plugin.settings.repoLocations = [];
          this.plugin.settings.repoLocations.push({ name: n, path: p });
          await this.plugin.saveAll();
          newNameInput.value = "";
          newPathInput.value = "";
          renderList();
        }));
  }

  // ============ 支持作者 ============
  private renderSupport(el: HTMLElement): void {
    const AFDIAN_URL = "https://www.ifdian.net/a/cjsycr";
    el.empty();
    el.addClass("ai-settings-support");

    new Setting(el)
      .setName("支持作者")
      .setDesc("如果这个插件对你有帮助，欢迎在爱发电请我喝杯咖啡 ☕")
      .addButton(btn => btn
        .setButtonText("在爱发电打开 ❤️")
        .setWarning()
        .onClick(() => {
          try {
            const electron = require("electron");
            const shell = electron && electron.shell;
            if (shell && typeof shell.openExternal === "function") {
              shell.openExternal(AFDIAN_URL);
            } else {
              window.open(AFDIAN_URL, "_blank", "noopener,noreferrer");
            }
          } catch (e) {
            window.open(AFDIAN_URL, "_blank", "noopener,noreferrer");
          }
        }));

    new Setting(el)
      .setName("爱发电链接")
      .setDesc(AFDIAN_URL)
      .addButton(btn => btn
        .setButtonText("复制")
        .onClick(async () => {
          try {
            await navigator.clipboard.writeText(AFDIAN_URL);
            new Notice("已复制爱发电链接");
          } catch (e) {
            new Notice("复制失败，请手动选择");
          }
        }));

    new Setting(el)
      .setName("插件版本")
      .setDesc("v" + this.plugin.manifest.version + " · MIT License")
      .addButton(btn => btn
        .setButtonText("查看更新日志")
        .onClick(() => {
          // 打开 vault 根目录下的 CHANGELOG.md（如果存在）
          this.app.workspace.openLinkText("CHANGELOG.md", "/", false);
        }));
  }
}
