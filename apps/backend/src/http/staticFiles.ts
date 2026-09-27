import { readFile, realpath, stat } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { extname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { BACKEND_MESSAGES } from "../messages.ts";
import { sendJson } from "./guard.ts";

const MIME_BY_EXT: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".gif": "image/gif",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ttf": "font/ttf",
  ".txt": "text/plain; charset=utf-8",
  ".wasm": "application/wasm",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

export function defaultWebRoot(): string {
  const here = fileURLToPath(new URL(".", import.meta.url));
  return resolve(here, "../../../web/dist");
}

export function isStaticRequest(method: string, pathname: string): boolean {
  const m = method.toUpperCase();
  if (m !== "GET" && m !== "HEAD") {
    return false;
  }
  if (pathname === "/health") {
    return false;
  }
  if (pathname === "/api" || pathname.startsWith("/api/")) {
    return false;
  }
  return true;
}

function mimeFor(filePath: string): string {
  const ext = extname(filePath).toLowerCase();
  return MIME_BY_EXT[ext] ?? "application/octet-stream";
}

function cacheControlFor(filePath: string): string {
  return extname(filePath).toLowerCase() === ".html" ? "no-store" : "public, max-age=31536000, immutable";
}

function isInsideRoot(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  if (rel === "") {
    return true;
  }
  return !rel.startsWith("..") && !isAbsolute(rel);
}

export function resolveStaticCandidate(webRoot: string, pathname: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (decoded.includes("\0") || decoded.includes("\\")) {
    return null;
  }
  const rootResolved = resolve(webRoot);
  const trimmed = decoded.replace(/^\/+/, "");
  const candidate = trimmed.length === 0 ? rootResolved : resolve(rootResolved, trimmed);
  if (!isInsideRoot(rootResolved, candidate)) {
    return null;
  }
  return candidate;
}

async function existingFile(candidate: string, webRoot: string): Promise<string | null> {
  let realRoot: string;
  try {
    realRoot = await realpath(webRoot);
  } catch {
    return null;
  }

  const openIfSafe = async (path: string): Promise<string | null> => {
    try {
      const real = await realpath(path);
      if (!isInsideRoot(realRoot, real)) {
        return null;
      }
      const info = await stat(real);
      return info.isFile() ? real : null;
    } catch {
      return null;
    }
  };

  const asFile = await openIfSafe(candidate);
  if (asFile !== null) {
    return asFile;
  }
  return openIfSafe(join(candidate, "index.html"));
}

function sendBytes(req: IncomingMessage, res: ServerResponse, filePath: string, body: Buffer): void {
  if (res.headersSent) {
    return;
  }
  const method = (req.method ?? "GET").toUpperCase();
  res.writeHead(200, {
    "Content-Type": mimeFor(filePath),
    "Content-Length": body.length,
    "Cache-Control": cacheControlFor(filePath),
    "X-Content-Type-Options": "nosniff",
  });
  if (method === "HEAD") {
    res.end();
    return;
  }
  res.end(body);
}

export async function tryServeStatic(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  webRoot: string,
): Promise<boolean> {
  const method = (req.method ?? "GET").toUpperCase();
  if (!isStaticRequest(method, url.pathname)) {
    return false;
  }
  const candidate = resolveStaticCandidate(webRoot, url.pathname);
  if (candidate === null) {
    sendJson(res, 403, { message: BACKEND_MESSAGES.forbiddenRequest });
    return true;
  }
  const filePath = await existingFile(candidate, webRoot);
  if (filePath === null) {
    return false;
  }
  let body: Buffer;
  try {
    body = await readFile(filePath);
  } catch {
    return false;
  }
  sendBytes(req, res, filePath, body);
  return true;
}
