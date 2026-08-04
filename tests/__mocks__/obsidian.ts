// Mock Obsidian module（Obsidian 是 Electron app，测试环境无法 import）
// 暴露我们实际用到的类
export class Plugin {
  app: any;
  manifest: any;
  loadData = async () => ({});
  saveData = async (_data: any) => {};
  addRibbonIcon = () => {};
  registerView = () => {};
  addSettingTab = () => {};
  addCommand = () => {};
  registerDomEvent = () => {};
  registerEvent = () => {};
}

export class PluginSettingTab {
  app: any;
  plugin: any;
  containerEl: HTMLElement = document.createElement("div");
  constructor(app: any, plugin: any) {
    this.app = app;
    this.plugin = plugin;
  }
  display(): void {}
  hide(): void {}
}

export class Setting {
  settingEl: HTMLElement = document.createElement("div");
  constructor(_containerEl: HTMLElement) {}
  setName(_name: string) { return this; }
  setDesc(_desc: string) { return this; }
  setHeading() { return this; }
  addText(_cb: any) { return this; }
  addToggle(_cb: any) { return this; }
  addSlider(_cb: any) { return this; }
  addDropdown(_cb: any) { return this; }
  addButton(_cb: any) { return this; }
  addTextArea(_cb: any) { return this; }
}

export class ItemView {
  containerEl: HTMLElement = document.createElement("div");
  iconEl: HTMLElement = document.createElement("div");
  constructor(_leaf: any) {}
  getViewType(): string { return ""; }
  getDisplayText(): string { return ""; }
  getIcon(): string { return ""; }
  onOpen(): void | Promise<void> {}
  onClose(): void | Promise<void> {}
}

export class WorkspaceLeaf {}
export class TFile {
  path: string = "";
  basename: string = "";
  extension: string = "md";
  constructor(_path?: string) {}
}
export class TFolder {
  path: string = "";
  children: any[] = [];
  constructor(_path?: string) {}
}

export class Modal {
  app: any;
  containerEl: HTMLElement = document.createElement("div");
  constructor(app: any) { this.app = app; }
  open(): void {}
  close(): void {}
  onOpen(): void {}
  onClose(): void {}
}

export class FuzzySuggestModal<T = any> {
  app: any;
  constructor(app: any) { this.app = app; }
  setPlaceholder(_s: string) { return this; }
  setInstructions(_i: any) { return this; }
  setEmptyState(_s: string) { return this; }
  open(): void {}
  close(): void {}
  getItems(): T[] { return []; }
  getItemText(_i: T): string { return ""; }
  onChooseItem(_i: T, _e: any): void {}
  onClose(): void {}
}

export class Menu {
  addItem(_cb: any): this { return this; }
  addSeparator(): this { return this; }
  showAtMouseEvent(_e: any): void {}
  showAtPosition(_p: any): void {}
}

export class Notice {
  constructor(_msg: string | DocumentFragment, _duration?: number) {}
}

export class FileSystemAdapter {
  getBasePath(): string { return ""; }
  getNewFileParent(_path: string): any { return null; }
}

export class Component {
  children: any[] = [];
  load(): void {}
  onload(): void {}
  onunload(): void {}
  unload(): void {}
}

export class MarkdownRenderer {
  static renderMarkdown(_md: string, _el: HTMLElement, _src: string, _comp: any): Promise<void> { return Promise.resolve(); }
}
