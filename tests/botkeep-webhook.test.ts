import { test } from "node:test";
import assert from "node:assert/strict";
import { handleInboundWebhook, MAX_WEBHOOK_BODY_BYTES } from "../src/lib/automation/inbound-webhook";
import { mintWebhookToken } from "../src/lib/automation/webhook-token";

function fixture(enabled = true) {
  const credential = mintWebhookToken();
  const jobs: { hookId: string; workspaceId: string; input: string }[] = [];
  const touched: string[] = [];
  const hook = { id: "hook-1", workspaceId: "workspace-1", tokenHash: credential.hash, enabled, inputTemplate: "Event: {{body}}", targetType: "machine", targetId: "machine-1" };
  return {
    credential, jobs, touched,
    dependencies: {
      findHook: async () => hook,
      enqueue: async (record: typeof hook, input: string) => { jobs.push({ hookId: record.id, workspaceId: record.workspaceId, input }); return "job-1"; },
      touch: async (id: string) => { touched.push(id); },
      render: (template: string, vars: Record<string, string>) => template.replace("{{body}}", vars.body),
    },
  };
}
const request = (body: string) => new Request("http://localhost/hooks", { method: "POST", body });

test("authenticated webhook normalizes input, enqueues in its workspace and returns 202", async () => {
  const f = fixture();
  const response = await handleInboundWebhook(request('{"event":"updated","authorization":"Bearer abcdefghijklmnop"}'), f.credential.token, f.dependencies);
  assert.equal(response.status, 202);
  assert.deepEqual(await response.json(), { accepted: true, job: "job-1" });
  assert.equal(f.jobs.length, 1);
  assert.equal(f.jobs[0].workspaceId, "workspace-1");
  assert.match(f.jobs[0].input, /"event": "updated"/);
  assert.doesNotMatch(f.jobs[0].input, /abcdefghijklmnop/);
  assert.deepEqual(f.touched, ["hook-1"]);
});

test("invalid secret and disabled hooks cannot enqueue jobs", async () => {
  const f = fixture();
  const badToken = f.credential.token.slice(0, -1) + (f.credential.token.endsWith("a") ? "b" : "a");
  assert.equal((await handleInboundWebhook(request("event"), badToken, f.dependencies)).status, 404);
  assert.equal(f.jobs.length, 0);
  const disabled = fixture(false);
  assert.equal((await handleInboundWebhook(request("event"), disabled.credential.token, disabled.dependencies)).status, 409);
  assert.equal(disabled.jobs.length, 0);
});

test("streamed payload over 64 KiB is rejected even with a forged small content-length", async () => {
  const f = fixture();
  const stream = new ReadableStream<Uint8Array>({ start(controller) {
    controller.enqueue(new Uint8Array(MAX_WEBHOOK_BODY_BYTES));
    controller.enqueue(new Uint8Array(1));
    controller.close();
  } });
  const req = new Request("http://localhost/hooks", { method: "POST", headers: { "content-length": "1" }, body: stream, duplex: "half" } as RequestInit);
  assert.equal((await handleInboundWebhook(req, f.credential.token, f.dependencies)).status, 413);
  assert.equal(f.jobs.length, 0);
});

test("payload limit counts UTF-8 bytes and permits exactly 64 KiB", async () => {
  const f = fixture();
  assert.equal((await handleInboundWebhook(request("é".repeat(MAX_WEBHOOK_BODY_BYTES / 2 + 1)), f.credential.token, f.dependencies)).status, 413);
  assert.equal((await handleInboundWebhook(request("x".repeat(MAX_WEBHOOK_BODY_BYTES)), f.credential.token, f.dependencies)).status, 202);
  assert.equal(f.jobs.length, 1);
});

test("an accounting failure after enqueue preserves the accepted response", async () => {
  const f = fixture();
  f.dependencies.touch = async () => { throw new Error("database unavailable"); };
  assert.equal((await handleInboundWebhook(request("event"), f.credential.token, f.dependencies)).status, 202);
  assert.equal(f.jobs.length, 1);
});
