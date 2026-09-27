import type { IncomingMessage, ServerResponse } from "node:http";
import type { Duplex } from "node:stream";
import { USER_FACING } from "@canvas/schema";
import { parseRunRequest } from "../execution/parseRunRequest.ts";
import { ExecutionHttpError, type ExecutionRuntime } from "../execution/runtime.ts";
import { BACKEND_MESSAGES } from "../messages.ts";
import {
  headerValue,
  isAllowedHost,
  isAllowedOrigin,
  sendJson,
  tokensEqual,
} from "./guard.ts";
import {
  acceptWebSocket,
  parseSubprotocols,
  tokenFromSubprotocols,
  WS_BEARER_PROTOCOL,
} from "./websocket.ts";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

async function withError(res: ServerResponse, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (err) {
    if (err instanceof ExecutionHttpError) {
      sendJson(res, err.status, { message: err.message });
      return;
    }
    sendJson(res, 500, { message: BACKEND_MESSAGES.requestFailed });
  }
}

export async function handleExecution(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  body: unknown,
  runtime: ExecutionRuntime,
): Promise<boolean> {
  const method = (req.method ?? "GET").toUpperCase();
  const path = url.pathname;
  if (!path.startsWith("/api/execution")) {
    return false;
  }

  if (path === "/api/execution/capabilities" && method === "GET") {
    sendJson(res, 200, await runtime.listCapabilities());
    return true;
  }

  if (path === "/api/execution/recipes" && method === "GET") {
    sendJson(res, 200, await runtime.listRecipes());
    return true;
  }

  if (path === "/api/execution/comfy/health" && method === "GET") {
    const probe = await runtime.probeComfy();
    sendJson(res, 200, { reachable: probe.reachable, message: probe.message });
    return true;
  }

  if (path === "/api/execution/comfy/recheck" && method === "POST") {
    const probe = await runtime.recheckComfy();
    sendJson(res, 200, { reachable: probe.reachable, message: probe.message });
    return true;
  }

  if (path === "/api/execution/runs/plan" && method === "POST") {
    await withError(res, async () => {
      const parsed = parseRunRequest(body);
      if (!parsed.ok) {
        sendJson(res, 400, { message: parsed.message });
        return;
      }
      const plan = await runtime.planRun(parsed.request);
      sendJson(res, 200, plan);
    });
    return true;
  }

  if (path === "/api/execution/runs" && method === "POST") {
    await withError(res, async () => {
      const parsed = parseRunRequest(body);
      if (!parsed.ok) {
        sendJson(res, 400, { message: parsed.message });
        return;
      }
      const snapshot = await runtime.startRun(parsed.request);
      sendJson(res, 200, snapshot);
    });
    return true;
  }

  const runMatch = /^\/api\/execution\/runs\/([^/]+)$/.exec(path);
  if (runMatch !== null && method === "GET") {
    const runId = decodeURIComponent(runMatch[1] ?? "");
    const snapshot = await runtime.getRun(runId);
    if (snapshot === null) {
      sendJson(res, 404, { message: USER_FACING.restartUncertain });
      return true;
    }
    sendJson(res, 200, snapshot);
    return true;
  }

  const cancelRun = /^\/api\/execution\/runs\/([^/]+)\/cancel$/.exec(path);
  if (cancelRun !== null && method === "POST") {
    await withError(res, async () => {
      const runId = decodeURIComponent(cancelRun[1] ?? "");
      const snapshot = await runtime.cancelRun(runId);
      sendJson(res, 200, snapshot);
    });
    return true;
  }

  const retry = /^\/api\/execution\/runs\/([^/]+)\/retry-failed$/.exec(path);
  if (retry !== null && method === "POST") {
    await withError(res, async () => {
      const runId = decodeURIComponent(retry[1] ?? "");
      sendJson(res, 200, await runtime.retryFailed(runId));
    });
    return true;
  }

  const resume = /^\/api\/execution\/runs\/([^/]+)\/resume$/.exec(path);
  if (resume !== null && method === "POST") {
    await withError(res, async () => {
      const runId = decodeURIComponent(resume[1] ?? "");
      sendJson(res, 200, await runtime.resumeInterrupted(runId));
    });
    return true;
  }

  const regen = /^\/api\/execution\/nodes\/([^/]+)\/regenerate-preview$/.exec(path);
  if (regen !== null && method === "POST") {
    await withError(res, async () => {
      const nodeId = decodeURIComponent(regen[1] ?? "");
      const result = await runtime.regeneratePreview(nodeId);
      if (!result.ok) {
        sendJson(res, 400, { message: result.message });
        return;
      }
      sendJson(res, 200, { ok: true });
    });
    return true;
  }

  const cancelTask = /^\/api\/execution\/tasks\/([^/]+)\/cancel$/.exec(path);
  if (cancelTask !== null && method === "POST") {
    await withError(res, async () => {
      const taskId = decodeURIComponent(cancelTask[1] ?? "");
      const task = await runtime.cancelTask(taskId);
      sendJson(res, 200, {
        ...task,
        message: runtime.lastCancelMessage(taskId) ?? USER_FACING.cancelling,
      });
    });
    return true;
  }

  void isRecord;
  sendJson(res, 404, { message: BACKEND_MESSAGES.requestFailed });
  return true;
}

export function handleExecutionUpgrade(
  req: IncomingMessage,
  socket: Duplex,
  head: Buffer,
  options: { token: string; port: number; runtime: ExecutionRuntime },
): boolean {
  let url: URL;
  try {
    url = new URL(req.url ?? "/", `http://127.0.0.1:${options.port}`);
  } catch {
    socket.destroy();
    return true;
  }
  const events = /^\/api\/execution\/runs\/([^/]+)\/events$/.exec(url.pathname);
  if (events === null) {
    return false;
  }

  const host = headerValue(req.headers.host);
  if (host === undefined || !isAllowedHost(host, options.port)) {
    socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
    socket.destroy();
    return true;
  }
  if (url.searchParams.has("token")) {
    socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
    socket.destroy();
    return true;
  }
  const origin = headerValue(req.headers.origin);
  if (origin !== undefined && !isAllowedOrigin(origin, options.port)) {
    socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
    socket.destroy();
    return true;
  }
  const protocols = parseSubprotocols(headerValue(req.headers["sec-websocket-protocol"]));
  const hasBare = protocols.includes(WS_BEARER_PROTOCOL);
  const provided = tokenFromSubprotocols(protocols);
  if (!hasBare || provided === null || !tokensEqual(provided, options.token)) {
    socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
    socket.destroy();
    return true;
  }

  const runId = decodeURIComponent(events[1] ?? "");
  const session = acceptWebSocket(req, socket, head, WS_BEARER_PROTOCOL);
  if (session === null) {
    socket.write("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
    socket.destroy();
    return true;
  }
  const abort = new AbortController();
  socket.on("close", () => abort.abort());
  void (async () => {
    try {
      for await (const event of options.runtime.watchRun(runId, abort.signal)) {
        if (abort.signal.aborted) {
          break;
        }
        session.sendText(JSON.stringify(event));
      }
    } finally {
      session.close();
    }
  })();
  return true;
}
