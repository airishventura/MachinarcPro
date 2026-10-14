// Disposable hosted receipt sink. Records every request; never deduplicates.
import { createServer } from "node:http";
import { mkdir, appendFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";

async function main() {
  const token = process.env.ACCEPTANCE_RECEIVER_TOKEN;
  if (!token || token.length < 32) throw new Error("Receiver token required");
  await mkdir(".validation", { recursive: true });
  createServer(async (request, response) => {
    if (request.headers.authorization !== `Bearer ${token}`) { response.writeHead(401).end(); return; }
    const mode = request.url?.match(/^\/receipts\/(durable|ambiguous)$/)?.[1];
    if (request.method !== "POST" || !mode) { response.writeHead(404).end(); return; }
    const chunks: Buffer[] = [];
    for await (const chunk of request) {
      chunks.push(Buffer.from(chunk));
      if (chunks.reduce((sum, item) => sum + item.length, 0) > 1024) { response.writeHead(413).end(); return; }
    }
    const body = Buffer.concat(chunks).toString();
    if (body !== JSON.stringify({ mode })) { response.writeHead(400).end(); return; }
    const receipt = { mode, receipt: randomUUID(), receivedAt: new Date().toISOString() };
    await appendFile(".validation/receipts.jsonl", JSON.stringify(receipt) + "\n");
    // Leave the caller without a result after the receiver has committed its write.
    if (mode === "ambiguous") await new Promise(resolve => setTimeout(resolve, 60_000));
    response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(receipt));
  }).listen(3000, "0.0.0.0", () => console.log("Acceptance receiver ready"));
}

main().catch(error => { console.error(error instanceof Error ? error.message : "Receiver failed"); process.exit(1); });
