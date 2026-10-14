// Independent generic webhook ingress; Machines execute in the durable worker.
import "dotenv/config";
import type { IncomingMessage } from "node:http";
import { readServiceConfig } from "@/lib/services/config";
import { startServiceHttp } from "@/lib/services/http";
import { installShutdown } from "@/lib/services/lifecycle";
import { obs } from "@/lib/security/redact";

// Cancellation drains the socket rather than destroying it, so a 413 can still reach the caller.
function requestBody(req: IncomingMessage) {
  let cleanup = () => {};
  return new ReadableStream<Uint8Array>({
    start(controller) {
      const data = (chunk: Buffer) => { controller.enqueue(chunk); if ((controller.desiredSize ?? 0) <= 0) req.pause(); };
      const end = () => { cleanup(); controller.close(); };
      const error = () => { cleanup(); controller.error(new Error("invalid payload")); };
      cleanup = () => { req.off("data", data); req.off("end", end); req.off("error", error); req.off("aborted", error); };
      req.on("data", data); req.once("end", end); req.once("error", error); req.once("aborted", error);
    },
    pull() { req.resume(); },
    cancel() { cleanup(); req.once("error", () => {}); req.resume(); },
  });
}

async function main() {
  const config = readServiceConfig("integrations");
  process.env.TZ = "UTC";
  const [{ handleInboundWebhook }, { pool }] = await Promise.all([import("@/lib/automation/inbound-webhook"), import("@/db")]);
  const http = await startServiceHttp({
    service: "integrations", port: config.port, host: config.host,
    ready: async () => { await pool.query("select 1"); return true; },
    onRequest: async (req, res) => {
      const match = /^\/(?:api\/)?hooks\/([^/]+)$/.exec(new URL(req.url ?? "/", "http://localhost").pathname);
      if (!match) return false;
      if (req.method !== "POST") {
        res.writeHead(405, { "Content-Type": "application/json", Allow: "POST" });
        res.end(JSON.stringify({ error: "use POST" }));
        return true;
      }
      const headers = new Headers();
      for (const [key, value] of Object.entries(req.headers)) if (value) headers.set(key, Array.isArray(value) ? value.join(", ") : value);
      const request = new Request("http://localhost/hooks", { method: "POST", headers, body: requestBody(req), duplex: "half" } as RequestInit);
      let response: Response;
      try { response = await handleInboundWebhook(request, match[1]); }
      finally {
        // Auth and declared-size rejections may not consume the body; drain without logging it.
        await request.body?.cancel().catch(() => undefined);
      }
      res.writeHead(response.status, { "Content-Type": "application/json" });
      res.end(await response.text());
      return true;
    },
  });
  installShutdown("machinarc-integrations", async () => { await http.close(); await pool.end(); }, config.shutdownMs);
  obs("service.started", { service: "machinarc-integrations", port: config.port });
}

main().catch(() => { obs("service.start_failed", { service: "machinarc-integrations" }); process.exitCode = 1; });
