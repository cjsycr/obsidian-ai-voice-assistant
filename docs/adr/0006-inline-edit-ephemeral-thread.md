# ADR 0006: 内联编辑——ephemeral thread 而非复用现有线程

- **状态**: 已接受
- **日期**: 2026-07-20

## 背景

内联编辑（Inline Edit）需要发送一个编辑 prompt 给 AI 并取回结果。需要决定使用哪个 thread。

## 方案

**最初方案：使用 ephemeral thread，用后即焚。**

每次 inline edit 创建一个新的 ephemeral thread，发送 prompt，等待回复，然后 thread 自动销毁。

## 问题

创建 ephemeral thread 会触发 `openviking-memory` 等 hook 插件的 `session-start` 和 `user-prompt-submit` hooks，这些 hooks 会消费 prompt 并阻止 agent 消息生成，导致 turn 完成时 items 为空。

## 最终方案

**复用当前笔记的现有 thread。**

- 通过 `NoteService.getCurrentThread()` 获取当前 thread ID
- 在其上发起 `turnStart`
- 收集 `agentMessage/delta` 流式通知积累文本
- `turnCompleted` 时提取完整结果
- 用户不会在聊天面板中看到这个 turn（不触发 UI 更新）

## 代价

- 内联编辑的 prompt 会出现在 thread 的 turn 历史中
- 如果用户查看 Codex 桌面版，会看到这些编辑请求
- 对于不关心 thread 历史的用户，这个代价可以接受

## 未来

如果 Codex 提供 `agent/chat/completions` 这样的独立 API，可以改为 direct API 调用，完全避免 thread 污染。
