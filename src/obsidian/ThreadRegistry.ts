// ThreadRegistry: 维护 {笔记相对路径 → Codex threadId} 映射
// 持久化到 .obsidian/plugins/ai-whispers/thread-map.json

import { App, Plugin } from "obsidian";
import { ThreadMap } from "../types";

const FILE_NAME = "thread-map.json";

export class ThreadRegistry {
  private map: ThreadMap = {};
  private plugin: Plugin;

  constructor(plugin: Plugin) {
    this.plugin = plugin;
  }

  async load(): Promise<void> {
    try {
      const adapter = this.plugin.manifest.id ? null : null;
      const data = await this.plugin.loadData();
      if (data && data.threadMap) {
        this.map = data.threadMap;
      }
    } catch (e) {
      // 第一次启动，map 为空
      this.map = {};
    }
  }

  async save(): Promise<void> {
    await (this.plugin as any).saveAll?.();
  }

  get(notePath: string): string | undefined {
    return this.map[notePath];
  }

  async set(notePath: string, threadId: string): Promise<void> {
    this.map[notePath] = threadId;
    await this.save();
  }

  async delete(notePath: string): Promise<void> {
    delete this.map[notePath];
    await this.save();
  }

  // 根据 threadId 反查笔记路径（用于 thread 收到通知时定位 UI）
  reverseLookup(threadId: string): string | undefined {
    for (const [path, id] of Object.entries(this.map)) {
      if (id === threadId) return path;
    }
    return undefined;
  }

  // 列出所有绑定的笔记
  all(): Array<{ notePath: string; threadId: string }> {
    return Object.entries(this.map).map(([notePath, threadId]) => ({ notePath, threadId }));
  }
}
