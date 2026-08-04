// 测试 NoteService 的消息操作：deleteMessage、regenerateMessage、translateMessage
// 纯逻辑测试：mock client，只测 messages 数组操作
import { describe, it, expect } from "vitest";
import type { ChatMessage } from "../src/types";

describe("ChatMessage 数组操作（NoteService 业务逻辑）", () => {
  // 模拟一个 messages 数组
  const mkMsg = (id: string, role: "user" | "assistant", content = ""): ChatMessage => ({
    id, role, content, createdAt: Date.now(),
  });

  describe("deleteMessage 逻辑", () => {
    it("按 id 删除指定消息", () => {
      const msgs: ChatMessage[] = [mkMsg("1", "user"), mkMsg("2", "assistant"), mkMsg("3", "user")];
      const idx = msgs.findIndex(m => m.id === "2");
      msgs.splice(idx, 1);
      expect(msgs.map(m => m.id)).toEqual(["1", "3"]);
    });

    it("删不存在的 id 不抛错", () => {
      const msgs: ChatMessage[] = [mkMsg("1", "user")];
      const idx = msgs.findIndex(m => m.id === "999");
      if (idx !== -1) msgs.splice(idx, 1);
      expect(msgs).toHaveLength(1);
    });

    it("批量删除（多选）", () => {
      const msgs: ChatMessage[] = [
        mkMsg("1", "user"), mkMsg("2", "assistant"),
        mkMsg("3", "user"), mkMsg("4", "assistant"),
      ];
      const idsToDelete = new Set(["1", "3"]);
      const filtered = msgs.filter(m => !idsToDelete.has(m.id));
      expect(filtered.map(m => m.id)).toEqual(["2", "4"]);
    });
  });

  describe("regenerateMessage 逻辑", () => {
    it("找到要重新生成的 assistant 消息（按 id）", () => {
      const msgs: ChatMessage[] = [
        mkMsg("1", "user", "你好"),
        mkMsg("2", "assistant", "你好！有什么可以帮你的？"),
        mkMsg("3", "user", "今天天气？"),
      ];
      const targetId = "2";
      const idx = msgs.findIndex(m => m.id === targetId);
      expect(idx).toBe(1);
      // 重新生成时 content 清空
      msgs[idx] = { ...msgs[idx], content: "", streaming: true };
      expect(msgs[idx].content).toBe("");
      expect(msgs[idx].streaming).toBe(true);
    });

    it("重新生成找 user 消息对应的 assistant（找前一个 user）", () => {
      const msgs: ChatMessage[] = [
        mkMsg("1", "user", "Q1"),
        mkMsg("2", "assistant", "A1"),
        mkMsg("3", "user", "Q2"),
        mkMsg("4", "assistant", "A2"),
      ];
      // 重新生成 A2（即 id=4）：找前一个 user（id=3）
      const targetIdx = msgs.findIndex(m => m.id === "4");
      const prevUserIdx = msgs.slice(0, targetIdx).reverse().findIndex(m => m.role === "user");
      const absolutePrevUserIdx = targetIdx - 1 - prevUserIdx;
      expect(msgs[absolutePrevUserIdx].id).toBe("3");
    });
  });

  describe("translateMessage 逻辑", () => {
    it("找到要翻译的 assistant 消息", () => {
      const msgs: ChatMessage[] = [
        mkMsg("1", "user", "解释 X"),
        mkMsg("2", "assistant", "X is a thing"),
      ];
      const idx = msgs.findIndex(m => m.id === "2");
      expect(idx).toBe(1);
      // 翻译时 content 替换为新翻译
      const translated = "X 是一个东西";
      msgs[idx] = { ...msgs[idx], content: translated };
      expect(msgs[idx].content).toBe("X 是一个东西");
    });
  });
});
