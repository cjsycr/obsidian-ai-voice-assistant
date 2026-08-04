# ADR 0003: 上下文注入——XML 标签包装而非结构化协议

- **状态**: 已接受
- **日期**: 2026-07-14

## 背景

向 AI 发送用户消息时，需要注入当前笔记的上下文（笔记路径、仓库信息、自定义指令等）。

## 方案

**在用户消息前包装 XML 风格的上下文块。**

```xml
<obsidian-context>
vault_root: /path/to/vault
active_note: notes/2026-07-20.md
siblings_in_folder: ["notes/meeting.md", "notes/ideas.md"]
</obsidian-context>

<user-input>
用户的实际问题
</user-input>
```

- 上下文和用户消息放在同一个 `text` UserInput 中
- 发送后可以通过正则表达式剥离上下文，恢复用户原始输入
- 使用 `stripSystemContext()` 函数在消息列表中还原显示

## 备选方案

- **分开的 UserInput**：`text` + `image` 作为独立 input 项。更规范但需要修改 `send()` 签名
- **System Message**：将上下文作为 system message 发送。更干净但 Codex 协议不支持多轮 system message

## 后果

- 实现简单，不需要修改 Codex 协议
- 所有模型都支持（纯文本）
- 剥离上下文需要额外的正则匹配，有一定脆弱性
- 上下文占用了用户消息的 token 预算
