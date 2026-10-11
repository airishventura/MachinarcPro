import type { ChatMessage, ToolCall } from "@/lib/ai/types";

/** Calls from the last persisted assistant batch that still need a tool response. */
export function outstandingToolCalls(messages: ChatMessage[]): ToolCall[] {
  let assistantIndex = messages.length - 1;
  while (assistantIndex >= 0 && messages[assistantIndex].role !== "assistant") assistantIndex--;
  if (assistantIndex < 0) return [];
  const assistant = messages[assistantIndex];
  if (assistant.role !== "assistant") return [];
  const answered = new Set(messages.slice(assistantIndex + 1).flatMap((message) => message.role === "tool" ? [message.toolCallId] : []));
  return (assistant.toolCalls ?? []).filter((call) => !answered.has(call.id));
}
