# Changelog

## v0.5.0 (2026-07-16) — "打磨与整理"

### 新增
- ✨ 顶部条 `✨ 询问 AI` + `⌃⏎ 发送 · ⏎ 换行`（方案 B 顶部标签）
- 🔍 对话内搜索（`Cmd/Ctrl+F`）· 青碧高亮 + 琥珀色当前定位 · 大小写切换 · `↑↓` 跳转
- 📊 消息区滚动进度条（overlay，平时隐藏；滚动时青碧细条 + 百分比气泡）
- 🗂 设置页 Tabs 分组：常规 / 外观 / 对话 / 快捷指令 / 斜杠指令 / 导出 / 仓库
- 💬 快捷指令胶囊 + 斜杠指令 `/` 面板（17 条 skill 风格默认）
- ⌨️ 空状态卡片：`@` `/` `⌘F` `⌘⏎` 四个快捷键卡
- 🕐 日期分隔线（今天 / 昨天 / M月D日）
- ✨ Streaming pill "AI 正在回复"（消息区顶部悬浮）
- 📋 复制成功 toast（青碧短提示，浅/深色都清晰）
- 🎨 AI role 后显示模型名（透明度 0.55，次要信息）
- 💠 typing 光标改成青碧闪烁小方块
- 🎨 代码块 Prism token 语法高亮（青碧家族配色）
- 📓 `@` 引用其他笔记：输入框直接打 `@`（非邮箱/URL 场景才触发）
- ⌨️ 输入框内 `/` `@` 触发不再抢字符 · Esc 可取消保留原字符
- 🧭 回到顶/底按钮 + 智能滚动跟随

### 外观
- 用户气泡改成柔和青碧 · 圆角 16px（V2 · 非对称饱满）
- AI 段落左侧 2px 青碧发际线（hover 变实色）
- 消息操作按钮上浮到气泡上方（Discord 风）
- 多选复选框放到气泡左侧内联（不再 absolute 定位）

### 重构 / 清理
- 抽出 `SlashModal.ts` (90 行) · `SearchController.ts` (136 行)
- ChatPanel.ts 从 967 → 898 行
- 删除 340MB 老备份 · `NoteService.ts.broken` · `package.json.bak` · `tests/hermes/`
- 删除遗留 `console.warn("CLICK FIRED")` 调试日志

### 安全
- 清理所有硬编码用户路径（`/Users/xxx` → `/path/to/xxx`）
- `verify-protocol.js` 改用 `process.env.OBSIDIAN_VAULT_PATH`
- 所有 `.innerHTML` 加 `// SAFE:` 注释（均为静态 SVG）
- README 追加《安全约定》章节
- `EventEmitter` 加类型定义（消灭 5 处 `as any`）

### 版本
- `manifest.json` / `package.json` / `versions.json` 统一到 0.5.0

---

# Changelog

## v0.2.0 (2026-07-15) - "Quality & Tests"

### 修复 / 改进

**数据安全**
- ✅ `saveAll()` 方法（merge settings + threadMap）— 解决 saveData 全量覆盖导致 threadMap 丢失的 bug
- ✅ NoteService.app 改 public（替代 `(service as any).app` 强转）
- ✅ 删 9 个开发残留的 console.log（保留 error/warn）

**清理 Dead Code**
- ✅ 删 `useDedicatedCwd` + `dedicatedCwd`（未实现）
- ✅ 删 `transport: "websocket"`（未实现）
- ✅ 删 `passSessionId`（未引用）
- ✅ 删 `processAttachments`（@file 附件，minimax 不支持）
- ✅ 删 `sendSystemMessage` + `buildSystemIntro`（dead code）
- ✅ 删 SettingTab 升级路径块

**性能**
- ✅ `rebuildMessagesFromTurns` 重试从 5 次×500ms（2.5s）→ 2 次×200ms（400ms）

**代码组织**
- ✅ 提取 `getVaultBasePath` 到 `src/utils/vault.ts`（消除 main.ts + NoteService 重复）
- ✅ buildContext 用 `getVaultBasePath`（之前用 `getRoot().path` 返回相对路径 ""）

**测试基础设施（新增）**
- ✅ vitest 4.1.10 + happy-dom
- ✅ `tests/utils/vault.test.ts`（7 个测试用例）
- ✅ `tests/CodexClient.test.ts`（4 个测试用例）
- ✅ `tests/__mocks__/obsidian.ts`（mock Obsidian 模块）
- ✅ `vitest.config.ts` 配置
- ✅ `npm test` 命令

### 已知问题 / 不做

- 增量 renderMessages（风险高，留待增量）
- NoteService 拆分（风险高）
- v0.2.0 修复有回归保护（新增测试）

## v0.1.0 (2026-07-14) - "First Working Version"

初始 work 版本。详见备份。
