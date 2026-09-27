import { createHash, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { VITE_DEV_PORT } from "../appData.ts";
import { BACKEND_MESSAGES } from "../messages.ts";

export { VITE_DEV_PORT };

export function allowedOrigins(port: number): readonly string[] {
  return [
    `http://127.0.0.1:${VITE_DEV_PORT}`,
    `http://localhost:${VITE_DEV_PORT}`,
    `http://127.0.0.1:${port}`,
    `http://localhost:${port}`,
  ];
}

export function allowedHosts(port: number): readonly string[] {
  return [`127.0.0.1:${port}`, `localhost:${port}`];
}

export function isAllowedOrigin(origin: string, port: number): boolean {
  return (allowedOrigins(port) as readonly string[]).includes(origin);
}

export function isAllowedHost(host: string, port: number): boolean {
  return (allowedHosts(port) as readonly string[]).includes(host.trim().toLowerCase());
}

export function headerValue(value: string | string[] | undefined): string | undefined {
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value) && typeof value[0] === "string") {
    return value[0];
  }
  return undefined;
}

export function extractBearerToken(req: IncomingMessage): string | undefined {
  const raw = headerValue(req.headers.authorization);
  if (raw === undefined) {
    return undefined;
  }
  const match = /^Bearer\s+(\S+)/i.exec(raw.trim());
  const token = match?.[1];
  if (token === undefined || token.length === 0) {
    return undefined;
  }
  return token;
}

export function tokensEqual(provided: string, expected: string): boolean {
  const a = createHash("sha256").update(provided).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

export type GuardOk = { ok: true };
export type GuardDeny = { ok: false; status: number; message: string };

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** 方案第 9.3 节：GET 媒体字节以票据为凭证，<img> 加不了 Bearer。仅该 GET 免令牌。 */
export function isMediaTicketGetPath(pathname: string): boolean {
  return /^\/api\/media-ticket\/[^/]+$/.test(pathname);
}

/** 访问日志丢掉 ticketId，也不记 Authorization。 */
export function redactMediaTicketPath(pathname: string): string {
  if (isMediaTicketGetPath(pathname)) {
    return "/api/media-ticket/:ticketId";
  }
  return pathname;
}

export function isTokenExemptPath(method: string, pathname: string, serveWeb: boolean): boolean {
  const m = method.toUpperCase();
  if (m === "GET" && pathname === "/health") {
    return true;
  }
  if (m === "GET" && isMediaTicketGetPath(pathname)) {
    return true;
  }
  if (!serveWeb) {
    return false;
  }
  if (m !== "GET" && m !== "HEAD") {
    return false;
  }
  if (pathname === "/api" || pathname.startsWith("/api/")) {
    return false;
  }
  return true;
}

export function inspectRequest(
  req: IncomingMessage,
  url: URL,
  options: { token: string; port: number; serveWeb?: boolean },
): GuardOk | GuardDeny {
  const host = headerValue(req.headers.host);
  if (host === undefined || !isAllowedHost(host, options.port)) {
    return { ok: false, status: 403, message: BACKEND_MESSAGES.forbiddenRequest };
  }

  const method = (req.method ?? "GET").toUpperCase();
  if (!isTokenExemptPath(method, url.pathname, options.serveWeb === true)) {
    const provided = extractBearerToken(req);
    if (provided === undefined || !tokensEqual(provided, options.token)) {
      return { ok: false, status: 401, message: BACKEND_MESSAGES.unauthorized };
    }
  }

  if (MUTATING.has(method)) {
    const origin = headerValue(req.headers.origin);
    if (origin === undefined || !isAllowedOrigin(origin, options.port)) {
      return { ok: false, status: 403, message: BACKEND_MESSAGES.forbiddenRequest };
    }
  }

  return { ok: true };
}

export function sendJson(
  res: ServerResponse,
  status: number,
  body: unknown,
  extraHeaders?: Record<string, string>,
): void {
  if (res.headersSent) {
    return;
  }
  const json = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(json),
    "Cache-Control": "no-store",
    ...extraHeaders,
  });
  res.end(json);
}

/** 方案第 9.9 节成功为 204；正文在部分客户端会被丢掉，所以 revision 同时进响应头。 */
export function sendWorkingCopyOk(
  res: ServerResponse,
  payload: { contentRevision: number; executionRevisions?: Record<string, number> },
): void {
  const extra: Record<string, string> = {
    "X-Content-Revision": String(payload.contentRevision),
  };
  if (payload.executionRevisions !== undefined) {
    extra["X-Execution-Revisions"] = JSON.stringify(payload.executionRevisions);
  }
  sendJson(res, 204, payload, extra);
}

export function applyCors(req: IncomingMessage, res: ServerResponse, port: number): void {
  const origin = headerValue(req.headers.origin);
  if (origin !== undefined && isAllowedOrigin(origin, port)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    res.setHeader("Access-Control-Expose-Headers", "X-Content-Revision, X-Execution-Revisions");
  }
}

export function handlePreflight(req: IncomingMessage, res: ServerResponse, port: number): boolean {
  if ((req.method ?? "").toUpperCase() !== "OPTIONS") {
    return false;
  }
  const origin = headerValue(req.headers.origin);
  const host = headerValue(req.headers.host);
  if (host === undefined || !isAllowedHost(host, port)) {
    sendJson(res, 403, { message: BACKEND_MESSAGES.forbiddenRequest });
    return true;
  }
  if (origin === undefined || !isAllowedOrigin(origin, port)) {
    sendJson(res, 403, { message: BACKEND_MESSAGES.forbiddenRequest });
    return true;
  }
  applyCors(req, res, port);
  res.writeHead(204);
  res.end();
  return true;
}
