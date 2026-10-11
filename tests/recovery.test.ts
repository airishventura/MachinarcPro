import { test } from "node:test";
import assert from "node:assert/strict";
import { outstandingToolCalls } from "../src/lib/runtime/recovery";
import type { ChatMessage, ToolCall } from "../src/lib/ai/types";
import { activeRuntimeMs } from "../src/lib/runtime/active-runtime";

const first: ToolCall = { id: "first", name: "http_request", args: { method: "POST" } };
const second: ToolCall = { id: "second", name: "calculator", args: { expression: "1 + 1" } };

test("recovery preserves every unanswered call before a provider request", () => {
  const messages: ChatMessage[] = [{ role: "assistant", content: "plan", toolCalls: [first, second] }];
  assert.deepEqual(outstandingToolCalls(messages), [first, second]);
  messages.push({ role: "tool", toolCallId: first.id, toolName: first.name, content: "done" });
  assert.deepEqual(outstandingToolCalls(messages), [second]);
});

test("responses from an earlier batch do not suppress calls in the latest batch", () => {
  const messages: ChatMessage[] = [
    { role: "assistant", content: "", toolCalls: [first] },
    { role: "tool", toolCallId: first.id, toolName: first.name, content: "done" },
    { role: "assistant", content: "", toolCalls: [first, second] },
  ];
  assert.deepEqual(outstandingToolCalls(messages), [first, second]);
});

test("fully answered batches and reasoning-only messages require no replay", () => {
  assert.deepEqual(outstandingToolCalls([
    { role: "assistant", content: "", toolCalls: [first] },
    { role: "tool", toolCallId: first.id, toolName: first.name, content: "done" },
  ]), []);
  assert.deepEqual(outstandingToolCalls([{ role: "assistant", content: "final result" }]), []);
  assert.deepEqual(outstandingToolCalls([{ role: "user", content: "task" }]), []);
});

test("approval waits longer than the deadline preserve time already spent executing", () => {
  const start = new Date(0);
  const approvals = [{ createdAt: new Date(30_000), decidedAt: new Date(3_630_000), status: "approved" }];
  assert.equal(activeRuntimeMs(start, approvals, 3_650_000), 50_000);
  // Reconstructing a driver after a crash keeps the same budget and counts time since decision.
  assert.equal(activeRuntimeMs(start, approvals, 3_660_000), 60_000);
});

test("repeated approvals exclude every wait without resetting earlier active execution", () => {
  const approvals = [
    { createdAt: new Date(20_000), decidedAt: new Date(620_000), status: "approved" },
    { createdAt: new Date(650_000), decidedAt: new Date(1_250_000), status: "denied" },
  ];
  assert.equal(activeRuntimeMs(new Date(0), approvals, 1_300_000), 100_000);
  assert.equal(activeRuntimeMs(new Date(0), approvals, 1_400_000), 200_000);
});

test("pending and overlapping approval intervals never double-credit the execution budget", () => {
  const approvals = [
    { createdAt: new Date(-10_000), decidedAt: new Date(20_000), status: "approved" },
    { createdAt: new Date(10_000), decidedAt: new Date(40_000), status: "approved" },
    { createdAt: new Date(50_000), decidedAt: null, status: "pending" },
  ];
  assert.equal(activeRuntimeMs(new Date(0), approvals, 1_000_000), 10_000);
  assert.equal(activeRuntimeMs(new Date(0), [{ createdAt: new Date(0), decidedAt: null, status: "approved" }], 50_000), 50_000);
});
