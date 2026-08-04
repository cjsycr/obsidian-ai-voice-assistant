// ActiveNoteTracker: 监听当前打开的笔记
// 通过 Obsidian 的 workspace 事件获取当前 Markdown 文件

import { App, TFile, WorkspaceLeaf } from "obsidian";
import { EventEmitter } from "events";

export type ActiveNoteEvent =
  | { type: "opened"; note: TFile; previous: TFile | null }
  | { type: "closed"; note: TFile }
  | { type: "renamed"; note: TFile; oldPath: string }
  | { type: "deleted"; note: TFile };

export class ActiveNoteTracker extends EventEmitter {
  private current: TFile | null = null;
  private app: App;

  constructor(app: App) {
    super();
    this.app = app;
  }

  start(): void {
    // 当前打开的文件
    this.current = this.getActiveFile();

    // 监听 leaf 变化
    this.app.workspace.on("active-leaf-change", (leaf: WorkspaceLeaf | null) => {
      const prev = this.current;
      const next = this.getActiveFile();
      if (prev?.path === next?.path) return;
      this.current = next;
      if (next) {
        this.emit("change", { type: "opened", note: next, previous: prev } as ActiveNoteEvent);
      } else if (prev) {
        this.emit("change", { type: "closed", note: prev } as ActiveNoteEvent);
      }
    });

    // 文件重命名
    this.app.vault.on("rename", (file, oldPath) => {
      if (file instanceof TFile && file.extension === "md") {
        this.emit("change", { type: "renamed", note: file, oldPath } as ActiveNoteEvent);
        if (this.current?.path === oldPath) this.current = file;
      }
    });

    // 文件删除
    this.app.vault.on("delete", (file) => {
      if (file instanceof TFile && file.extension === "md") {
        this.emit("change", { type: "deleted", note: file } as ActiveNoteEvent);
        if (this.current?.path === file.path) this.current = null;
      }
    });
  }

  private getActiveFile(): TFile | null {
    const file = this.app.workspace.getActiveFile();
    if (file && file.extension === "md") return file;
    return null;
  }

  getCurrent(): TFile | null { return this.current; }
}
