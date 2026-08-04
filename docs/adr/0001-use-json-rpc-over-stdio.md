# ADR 0001: 使用 JSON-RPC over stdio 与 Codex 通信

- **状态**: 已接受
- **日期**: 2026-07-14

## 背景

需要与 Codex app-server 建立通信通道。有两个选择：
1. 使用 Codex 官方 SDK（`@openai/codex-sdk`）
2. 自己实现 JSON-RPC 客户端，通过 stdio 通信

## 方案

选择方案 2：自建 JSON-RPC 客户端。

- 通过 `child_process.spawn` 启动 `codex app-server --stdio`
- 使用 `readline` 逐行读取 stdout 的 JSON-RPC 消息
- 实现 `request()` 方法发送请求并等待响应
- 通过 `EventEmitter` 分发异步通知（`agentMessage/delta`、`turn/completed` 等）

## 备选方案

- **使用官方 SDK**：更省事，协议兼容性更好，但增加了依赖体积和版本同步风险
- **WebSocket 传输**：更灵活，但需要额外的端口和连接管理

## 后果

- 不需要引入 `@openai/codex-sdk` 依赖
- 完全控制协议解析，可以轻松处理非标准通知
- 需要自行维护协议兼容性（当 Codex 更新 JSON-RPC 协议时）
- 标准错误（stderr）需要单独处理，否则会刷屏
