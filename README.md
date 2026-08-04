# AI Whispers · AI 耳语者

> **A right-side panel that turns Obsidian into a Codex-powered AI workspace — one persistent thread per note, zero API key, zero extra cost.**

This plugin embeds your local Codex into Obsidian's right sidebar. Open any note, get an instant AI chat bound to that note's context. Features include streamed responses, visible reasoning, inline `@note` references, `/` slash commands, and `{{selection}}` templates — all wired through the local Codex app-server (JSON-RPC over stdio), so nothing leaves your machine.

Free for everyone with a Codex subscription.

一个在 Obsidian 右侧栏运行的 AI 助手，直接连接你本机的 Codex 桌面版，不需要 API key。

## 核心特性

- 🤖 **零成本**：复用你已有的 Codex 订阅，不走第三方 API
- 📄 **自动识别笔记**：打开任何 .md 笔记，右边栏自动显示对应的 AI 对话
- 💬 **持续对话**：每个笔记有独立的 thread 历史，切回来能继续
- ⚡ **流式响应**：AI 打字机效果，实时显示
- 🎯 **直接读 vault**：AI 用 Codex 自带的文件工具读你的笔记，零绕弯
- 🔌 **桌面版同步**：在 Codex 桌面版能看到所有 AI 对话
- 🧵 **Thread 管理器**：仪表盘式的会话面板，支持归档/恢复/重命名/批量删除
- 🔍 **对话内搜索**：`⌘F` 在当前对话中定位关键词
- ✂️ **多选导出**：批量选中消息导出为 Markdown
- 🧠 **思考过程**：推理模型的 reasoning 实时展示 + 可折叠
- 💡 **快捷指令 & 斜杠指令**：输入框左下角胶囊按钮 + `/` 唤起指令面板，支持 `{{selection}}` `{{note-title}}` `{{date}}` 等变量
- 🔗 **@ 就地补全**：输入 `@` 弹出 Cursor 风的笔记候选，边打字边过滤

## 快捷键

| 组合 | 作用 |
|---|---|
| `⌘ ⏎` / `Ctrl ⏎` | 发送消息 |
| `⏎` | 换行 |
| `⌘ F` / `Ctrl F` | 在当前对话中搜索 |
| `@` | 打开笔记引用补全（输入 `@ ` 空格可正常输入 @） |
| `/` | 打开斜杠指令面板（`/ ` 空格可正常输入 /） |
| `Esc` | 关闭当前浮层（补全 / 搜索 / 引导） |

## 模板变量

快捷指令和斜杠指令的 prompt 里可以写 `{{变量}}`，发送前会自动替换：

| 变量 | 值 |
|---|---|
| `{{selection}}` | 编辑器当前选中文本 |
| `{{note-title}}` | 当前笔记标题（不含扩展名） |
| `{{note-path}}` | 当前笔记 vault 相对路径 |
| `{{note-content}}` | 当前笔记全文（异步读取） |
| `{{date}}` | 今日 `YYYY-MM-DD` |
| `{{time}}` | 现在 `HH:MM` |
| `{{clipboard}}` | 系统剪贴板文本 |

## 前置要求

1. **Codex 桌面版**（或 CLI）已安装
2. 终端能跑 `codex --version`（即 `codex` 在 PATH 里）
3. 已在 Codex 登录（`codex login`）

## 安装（开发模式）

```bash
# 1. 装依赖
npm install

# 2. 打包（开发模式带 sourcemap）
npm run dev

# 3. 拷贝到 Obsidian 插件目录
VAULT=~/Documents/Obsidian   # 改成你的 vault 路径
PLUGIN_DIR="$VAULT/.obsidian/plugins/ai-whispers"
mkdir -p "$PLUGIN_DIR"
cp main.js manifest.json styles.css "$PLUGIN_DIR/"
```

然后在 Obsidian 设置 → 第三方插件 → 启用 "AI Whispers"。

## 使用

1. 启用插件后，Obsidian 右侧栏自动出现 🤖 AI 助手图标
2. 点击图标打开聊天面板
3. 打开一个 .md 笔记（注意：路径是 vault 内的相对路径）
4. 在下面输入框问 AI 即可，AI 会自动看到当前笔记内容

## 工作原理

```
┌──────────────────┐
│ Obsidian 插件     │
│  AssistantView   │
└────────┬─────────┘
         │ spawn codex app-server --stdio
         ▼
┌──────────────────┐
│ Codex app-server │  (JSON-RPC 协议)
└────────┬─────────┘
         │
         ▼
   ┌──────────┐
   │   LLM    │
   └──────────┘
```

**关键设计**：
- thread.cwd = vault 根目录（**不是独立项目目录**），AI 用 Codex 自带文件工具直接读 vault
- thread.name = `🤖 笔记相对路径`（前缀标识 AI 工作）
- thread.threadSource = `obsidian-ai-assistant`（标准字段，将来 Codex 桌面版支持按 source 过滤时立即受益）
- thread 创建/恢复/归档自动管理

## 常见问题（FAQ）

<details>
<summary><b>Q1：启动后一直显示 "⏳ 等待 Codex 启动…"</b></summary>

- 打开终端跑一次 `codex --version`，确认 CLI 能被找到
- 若装的是自定义路径，去设置 → 常规 → "Codex CLI 路径" 填绝对路径（比如 `/opt/homebrew/bin/codex`）
- 检查 Obsidian 开发者控制台（`⌘⌥I`）是否有 `codex-client` 相关报错
</details>

<details>
<summary><b>Q2：模型不对 / 想换成 MiniMax-M3、DeepSeek 等</b></summary>

- 推荐：编辑 `~/.codex/config.toml`，用 `model` / `model_provider` 全局配置
- 也可以在设置 → 常规 → "模型" / "模型 Provider" 里覆盖（留空 = 跟随全局）
</details>

<details>
<summary><b>Q3：AI 回复里的思考过程看不到 / 想关掉</b></summary>

- 只有推理模型（gpt-5 / o1 / o3 / ark-code-latest …）才产生 reasoning
- MiniMax-M3、gpt-4o 等普通模型不生成思考过程
- 若想默认折叠：设置 → 对话 → "思考过程默认折叠"
</details>

<details>
<summary><b>Q4：@ 或 / 我想真的当字符输入</b></summary>

- 输入 `@` 或 `/` 后紧跟一个空格，浮层会自动关闭，字符原样保留
- 也可以在浮层弹出后按 `Esc` 关闭继续输入
</details>

<details>
<summary><b>Q5：如何重新看引导教程</b></summary>

- 设置 → 常规 → "重新播放首次引导" → 点"播放"
</details>

<details>
<summary><b>Q6：Threads 管理器在哪打开</b></summary>

- 左边栏 `list-video` 图标（一个视频列表图标）
- 或命令面板搜 "Codex Threads"
</details>

## 架构

```
src/
├── main.ts                    # 插件入口
├── types.ts                   # 共享类型
├── codex/
│   └── CodexClient.ts         # JSON-RPC stdio 客户端
├── obsidian/
│   ├── ActiveNoteTracker.ts   # 监听 active-leaf-change
│   ├── ThreadRegistry.ts      # {notePath → threadId} 映射
│   └── NoteService.ts         # 业务核心
├── view/
│   ├── AssistantView.ts       # ItemView（右侧栏）
│   └── ChatPanel.ts           # 聊天 UI
└── settings/
    └── SettingTab.ts          # 设置面板
```

## 协议验证

`scripts/verify-protocol.js` 是一个独立的 Node 脚本，验证 Codex app-server 协议能跑通：

```bash
node scripts/verify-protocol.js
```

## 升级路径

未来如果要切换到"独立项目"模式（thread.cwd 不在 vault），在设置面板：
- 勾选「使用独立 cwd」
- 填独立目录路径
- 写一个 Obsidian Notes MCP server 暴露 `read_note` / `append_to_note` 等工具

参见 `docs/UPGRADE-PATH.md`（待写）。

## 已知限制

- Codex 桌面版必须已登录（用 ChatGPT 账户）
- 第一次启动 Codex 进程需要 1-2 秒
- 长笔记会截断到 8000 字符（避免 token 爆掉）

## 协议来源

- [Codex app-server schema](https://github.com/openai/codex/blob/main/codex-rs/app-server/schema)
- 协议细节来自 `codex app-server generate-json-schema --out ./schema`

## 测试

```bash
# 跑测试
npm test

# 监视模式（开发时用）
npm run test:watch
```

### 测试覆盖

- `tests/utils/vault.test.ts` — 7 个用例（getVaultBasePath 各种边界）
- `tests/CodexClient.test.ts` — 4 个用例（路径解析逻辑）

### 写新测试

```typescript
// tests/MyFeature.test.ts
import { describe, it, expect } from "vitest";
import { myPureFunction } from "../src/myFeature";

describe("myPureFunction", () => {
  it("should work", () => {
    expect(myPureFunction("input")).toBe("output");
  });
});
```

## 安全约定（贡献者请阅读）

1. **绝不将用户输入拼进 `innerHTML`**。UI 里已有的 `innerHTML` 都是静态 SVG / 键帽标签，代码中标注了 `// SAFE:` 注释。新增 DOM 时请一律使用 Obsidian 提供的 `createEl / createDiv / createSpan / setText` 或原生 `textContent` 赋值。
2. **不使用 `eval` / `new Function` / `document.write`**。
3. **不硬编码用户目录路径**（如 `/Users/xxx/…`）。需要用户路径时用 `process.env.HOME` 或运行时 API 探测。
4. **仅通过 Codex CLI stdio 与外界通信**。本插件不做任何 HTTP 请求。
5. **本地文件写入范围仅限 vault 内**（导出目录）以及 plugin data.json。

## 更新日志

完整的版本变更记录见 [`docs/CHANGELOG.md`](docs/CHANGELOG.md)。

---

## 开发者说明

### 打包体积上限（Bundle size budget）

仓库有一个 `tests/bundle-size.test.ts` 会在每次 `npm test` 时校验产物体积，防止无意识的 bundle 膨胀：

| 产物 | 当前基线 (v0.5.0) | 硬上限 | 余量 |
|---|---:|---:|---:|
| `main.js` | ≈ 101 KB | **160 KB** | +59 KB / ~58% |
| `styles.css` | ≈ 42 KB | **80 KB** | +38 KB / ~90% |

**规则：**
1. **日常开发**：普通功能增改都应该在余量内消化。若不小心超上限，先检查是不是引入了大依赖或死代码，而不是直接提上限。
2. **合理超阈值**：如果新功能确实需要更多空间（比如接入 Prism.js 全套语言包），请在**同一个 PR** 里：
   - 更新 `tests/bundle-size.test.ts` 里的 `MAX_MAIN_JS_KB` / `MAX_STYLES_CSS_KB`
   - 更新本 README 的表格
   - 在 commit / PR 里说明为什么需要涨
3. **参考**：竞品同类插件通常 500 KB – 4 MB，我们的目标是**保持"轻量 + 中重量级功能"**这个稀有组合。

### 打包分析

`npm run build` 会在 `production` 模式下额外生成 `metafile.json`（gitignored）。
把它拖到 https://esbuild.github.io/analyze/ 可以看到"哪个模块占了多少字节"的树图，指导后续瘦身。

终端也会打出 top-10 大模块的简要列表。

## Support / 爱发电

If this plugin makes your Obsidian + Codex workflow a little better, you're welcome to [buy me a coffee on Afdian](https://www.ifdian.net/a/cjsycr) ☕ — it keeps the updates coming.

如果这个插件对你有帮助，欢迎在[爱发电](https://www.ifdian.net/a/cjsycr)请我喝杯咖啡 ☕，能让更新持续得更久。
