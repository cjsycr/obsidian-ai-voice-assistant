// Thread 相关的纯函数辅助 —— 从 NoteService 抽出
// 只做无副作用的字符串/数据转换，不碰任何 service 状态

import { CodexClient } from "../codex/CodexClient";
import { ChatMessage, PluginSettings } from "../types";
import { stripSystemContext } from "./ContextBuilder";

/** 组装 thread 级别 baseInstructions（新建 thread 时用） */
export function buildBaseInstructions(settings: PluginSettings): string {
  let s = "你是 Obsidian AI 助手插件调用的 Codex agent。用户在你这里讨论他们的笔记。\n";
  s += "你可以使用 fs 工具直接读取 vault 根目录下的所有文件，不需要搜索整个电脑。\n";
  if (settings.customInstructions) {
    s += "\n【用户自定义指令】\n" + settings.customInstructions + "\n";
  }
  if (settings.repoLocations && settings.repoLocations.length > 0) {
    s += "\n【用户的本地仓库位置】\n";
    settings.repoLocations.forEach(r => {
      s += "- " + r.name + ": " + r.path + "\n";
    });
    s += "这些是用户已知的本地内容位置。如果用户问起相关文件，直接用 fs 工具读取这些路径。\n";
  }
  return s;
}

/**
 * 从 thread 的 turns 里重建消息列表（用于打开旧 thread 时恢复历史）
 * 若 thread.turns 为空则尝试从 client 拉一次 turns list（带简单重试）
 */
export async function rebuildMessagesFromTurns(
  client: CodexClient,
  thread: any,
): Promise<ChatMessage[]> {
  const out: ChatMessage[] = [];
  let turns: any[] = thread.turns || [];
  if (turns.length === 0) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const r: any = await client.request("thread/turns/list", { threadId: thread.id });
        turns = r.data || [];
        if (turns.length > 0) break;
        if (attempt < 2) await new Promise(res => setTimeout(res, 200));
      } catch (e: any) {
        console.error("[AI Assistant] turns/list failed (attempt " + attempt + "):", e);
      }
    }
  }
  for (const turn of turns) {
    let currentReasoning: string | undefined;
    for (const item of (turn.items || [])) {
      if (item.type === "reasoning") {
        currentReasoning = (item as any).summary || (item as any).text || "";
      } else if (item.type === "userMessage") {
        const rawText = (item.content || []).map((c: any) => c.text || "").join("\n");
        const text = stripSystemContext(rawText);
        if (text) {
          out.push({
            id: `u-${item.id}`,
            role: "user",
            content: text,
            createdAt: Date.now(),
            itemId: item.id,
            turnId: turn.id,
          });
        }
        currentReasoning = undefined;
      } else if (item.type === "agentMessage") {
        const text = (item as any).text || "";
        if (text) {
          const msg: ChatMessage = {
            id: `a-${item.id}`,
            role: "assistant",
            content: text,
            createdAt: Date.now(),
            itemId: item.id,
            turnId: turn.id,
          };
          if (currentReasoning) msg.reasoning = currentReasoning;
          out.push(msg);
        }
        currentReasoning = undefined;
      }
    }
  }
  return out;
}
