import "server-only";
import http from "node:http";
import https from "node:https";
import dns from "node:dns";
import net from "node:net";
import zlib from "node:zlib";

export class NetError extends Error {
  constructor(public kind: "blocked" | "invalid_url" | "timeout" | "too_large" | "network" | "too_many_redirects" | "domain_not_allowed", message: string) { super(message); }
}

const BLOCKED_HOSTS = [/^localhost$/i, /\.localhost$/i, /\.local$/i, /\.internal$/i, /^metadata(\.google\.internal)?$/i, /^instance-data$/i];

function v4ToInt(ip: string) { return ip.split(".").reduce((a, o) => (a << 8) + Number(o), 0) >>> 0; }
const V4_BLOCKS: [string, number][] = [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12],
  ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
];

/** True when an IP literal is loopback, private, link-local, metadata, multicast or otherwise non-public. */
export function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const n = v4ToInt(ip);
    return V4_BLOCKS.some(([base, bits]) => (n >>> (32 - bits)) === (v4ToInt(base) >>> (32 - bits)));
  }
  if (net.isIPv6(ip)) {
    const x = ip.toLowerCase().replace(/^\[|\]$/g, "");
    if (x === "::" || x === "::1") return true;
    const mapped = x.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/) ?? x.match(/^::(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateIp(mapped[1]);
    const hexMapped = x.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (hexMapped) { const a = parseInt(hexMapped[1], 16), b = parseInt(hexMapped[2], 16); return isPrivateIp(`${a >> 8}.${a & 255}.${b >> 8}.${b & 255}`); }
    const first = parseInt(x.split(":")[0] || "0", 16);
    if ((first & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
    if ((first & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
    if ((first & 0xff00) === 0xff00) return true; // multicast
    if (x.startsWith("64:ff9b:")) return true; // NAT64 may reach internal v4
    if (x.startsWith("2001:db8")) return true;
    return false;
  }
  return true;
}

export function hostAllowed(host: string, allow?: string[]) {
  if (!allow || !allow.length) return true;
  const h = host.toLowerCase();
  return allow.some((d) => { const dd = d.toLowerCase().replace(/^\*\./, ""); return h === dd || h.endsWith(`.${dd}`); });
}

/** Validates a URL string before any network activity. */
export function assertPublicUrl(raw: string, allowDomains?: string[]): URL {
  let u: URL;
  try { u = new URL(raw); } catch { throw new NetError("invalid_url", "Invalid URL."); }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new NetError("blocked", "Only http and https URLs are allowed.");
  if (u.username || u.password) throw new NetError("blocked", "Credentials in URLs are not allowed.");
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (!host || BLOCKED_HOSTS.some((r) => r.test(host)) || !host.includes(".") && !net.isIP(host)) throw new NetError("blocked", `Destination ${host || "(empty)"} is not a public host.`);
  if (net.isIP(host) && isPrivateIp(host)) throw new NetError("blocked", `Destination ${host} is a private or reserved address.`);
  if (/^\d+$/.test(host) || /^0x/i.test(host)) throw new NetError("blocked", "Numeric host encodings are not allowed.");
  if (u.port && !["80", "443", "8080", "8443"].includes(u.port)) throw new NetError("blocked", `Port ${u.port} is not allowed.`);
  if (!hostAllowed(host, allowDomains)) throw new NetError("domain_not_allowed", `${host} is not in the allowed domain list.`);
  return u;
}

/** DNS lookup that refuses to connect to non-public addresses (defends against DNS rebinding). */
function safeLookup(hostname: string, options: dns.LookupOptions, cb: (err: NodeJS.ErrnoException | null, address: string | dns.LookupAddress[], family?: number) => void) {
  dns.lookup(hostname, { ...options, all: true }, (err, addrs) => {
    if (err) return cb(err, "", 0);
    const list = (addrs as dns.LookupAddress[]);
    const bad = list.find((a) => isPrivateIp(a.address));
    if (!list.length || bad) return cb(Object.assign(new Error(`Blocked: ${hostname} resolves to a private address.`), { code: "EBLOCKED" }), "", 0);
    if (options.all) return cb(null, list);
    cb(null, list[0].address, list[0].family);
  });
}

export type SafeResponse = { status: number; url: string; headers: Record<string, string>; body: Buffer; truncated: boolean; redirects: string[] };

export async function safeFetch(rawUrl: string, opts: { method?: "GET" | "POST"; headers?: Record<string, string>; body?: string; timeoutMs?: number; maxBytes?: number; maxRedirects?: number; allowDomains?: string[]; signal?: AbortSignal } = {}): Promise<SafeResponse> {
  const maxRedirects = opts.maxRedirects ?? 3, maxBytes = opts.maxBytes ?? 2_000_000, timeoutMs = opts.timeoutMs ?? 12_000;
  const deadline = Date.now() + timeoutMs;
  let url = assertPublicUrl(rawUrl, opts.allowDomains);
  let method = opts.method ?? "GET", body = opts.body;
  const redirects: string[] = [];
  for (let hop = 0; ; hop++) {
    const res = await once(url, method, opts.headers ?? {}, body, Math.max(500, deadline - Date.now()), maxBytes, opts.signal);
    if ([301, 302, 303, 307, 308].includes(res.status) && res.headers.location) {
      if (hop >= maxRedirects) throw new NetError("too_many_redirects", `Exceeded ${maxRedirects} redirects.`);
      const next = new URL(res.headers.location, url).toString();
      url = assertPublicUrl(next, opts.allowDomains); // re-validate every hop
      redirects.push(url.toString());
      if (res.status === 303 || ((res.status === 301 || res.status === 302) && method === "POST")) { method = "GET"; body = undefined; }
      continue;
    }
    return { ...res, url: url.toString(), redirects };
  }
}

function once(url: URL, method: string, headers: Record<string, string>, body: string | undefined, timeoutMs: number, maxBytes: number, signal?: AbortSignal) {
  return new Promise<Omit<SafeResponse, "url" | "redirects">>((resolve, reject) => {
    const lib = url.protocol === "https:" ? https : http;
    const req = lib.request(url, {
      method, lookup: safeLookup as unknown as typeof dns.lookup, timeout: timeoutMs, signal,
      headers: { "user-agent": "MachinArcBot/1.0 (+https://machinarcpro.com)", "accept-encoding": "gzip, deflate, br", accept: "*/*", ...headers, ...(body ? { "content-length": String(Buffer.byteLength(body)) } : {}) },
    }, (res) => {
      const chunks: Buffer[] = []; let size = 0, truncated = false;
      const enc = String(res.headers["content-encoding"] ?? "");
      const stream = enc.includes("br") ? res.pipe(zlib.createBrotliDecompress()) : enc.includes("gzip") ? res.pipe(zlib.createGunzip()) : enc.includes("deflate") ? res.pipe(zlib.createInflate()) : res;
      const status = res.statusCode ?? 0;
      const hdrs = Object.fromEntries(Object.entries(res.headers).map(([k, v]) => [k, Array.isArray(v) ? v.join(", ") : String(v ?? "")]));
      if ([301, 302, 303, 307, 308].includes(status)) { res.resume(); return resolve({ status, headers: hdrs, body: Buffer.alloc(0), truncated: false }); }
      stream.on("data", (c: Buffer) => { size += c.length; if (size > maxBytes) { truncated = true; chunks.push(c.subarray(0, Math.max(0, c.length - (size - maxBytes)))); req.destroy(); stream.destroy(); resolve({ status, headers: hdrs, body: Buffer.concat(chunks), truncated }); } else chunks.push(c); });
      stream.on("end", () => resolve({ status, headers: hdrs, body: Buffer.concat(chunks), truncated }));
      stream.on("error", (e) => (truncated ? undefined : reject(new NetError("network", e.message))));
    });
    req.on("timeout", () => { req.destroy(); reject(new NetError("timeout", `Request timed out after ${Math.round(timeoutMs / 1000)}s.`)); });
    req.on("error", (e: NodeJS.ErrnoException) => {
      if (e.code === "EBLOCKED" || /Blocked:/.test(e.message)) reject(new NetError("blocked", e.message.replace(/^.*Blocked: /, "Blocked: ")));
      else if (e.name === "AbortError") reject(new NetError("timeout", "Request cancelled."));
      else reject(new NetError("network", e.code === "ENOTFOUND" ? `Host not found: ${url.hostname}` : `Network error: ${e.code ?? e.message}`));
    });
    if (body) req.write(body);
    req.end();
  });
}

/** Extracts readable text from HTML without executing anything. */
export function htmlToText(html: string) {
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim() ?? "";
  const canonical = html.match(/<link[^>]+rel=["']canonical["'][^>]*href=["']([^"']+)["']/i)?.[1] ?? null;
  const description = html.match(/<meta[^>]+name=["']description["'][^>]*content=["']([^"']*)["']/i)?.[1] ?? html.match(/<meta[^>]+property=["']og:description["'][^>]*content=["']([^"']*)["']/i)?.[1] ?? "";
  const main = html.match(/<(article|main)[\s\S]*?<\/\1>/i)?.[0] ?? html;
  const text = main
    .replace(/<(script|style|noscript|svg|nav|footer|header|form|iframe|template)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(br|p|div|li|h[1-6]|tr|section)[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/[ \t\f\v]+/g, " ").replace(/\n\s*\n+/g, "\n\n").trim();
  return { title: decode(title), canonical, description: decode(description), text };
}
const decode = (s: string) => s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").trim();
