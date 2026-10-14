import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { obs } from "@/lib/security/redact";

export async function startServiceHttp(options: {
  service: string; port: number; host: string; ready?: () => Promise<boolean>;
  onRequest?: (request: IncomingMessage, response: ServerResponse) => Promise<boolean>;
}) {
  let closing = false;
  const server = createServer((request, response) => {
    void (async () => {
      const path = new URL(request.url ?? "/", "http://localhost").pathname;
      if (request.method === "GET" && path === "/health") {
        const ready = !closing && (!options.ready || await options.ready());
        response.writeHead(ready ? 200 : 503, { "Content-Type": "application/json", "Cache-Control": "no-store" });
        response.end(JSON.stringify({ status: ready ? "ok" : "unavailable", service: `machinarc-${options.service}` }));
      } else if (!options.onRequest || !await options.onRequest(request, response)) {
        response.writeHead(404, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ error: "Not found" }));
      }
    })().catch(() => {
      obs("service.request_failed", { service: options.service });
      if (!response.headersSent) response.writeHead(503, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: "Service unavailable" }));
    });
  });
  server.requestTimeout = 30_000;
  server.headersTimeout = 10_000;
  server.maxHeadersCount = 50;
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port, options.host, () => { server.off("error", reject); resolve(); });
  });
  return { async close() {
    closing = true;
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  } };
}
