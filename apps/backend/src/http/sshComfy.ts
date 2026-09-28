import type { IncomingMessage, ServerResponse } from "node:http";
import { USER_FACING } from "@canvas/schema";
import type { ExecutionRuntime } from "../execution/runtime.ts";
import { writeUseLocalComfy } from "../execution/useLocalComfy.ts";
import { BACKEND_MESSAGES } from "../messages.ts";
import type { ComfyTunnel } from "../ssh/comfyTunnel.ts";
import { sendJson } from "./guard.ts";

export async function handleSshComfy(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  body: unknown,
  deps: {
    tunnel: ComfyTunnel;
    runtime: ExecutionRuntime;
  },
): Promise<boolean> {
  const method = (req.method ?? "GET").toUpperCase();
  const path = url.pathname;
  if (!path.startsWith("/api/app/ssh-comfy")) {
    return false;
  }

  if (path === "/api/app/ssh-comfy" && method === "GET") {
    const state = await deps.tunnel.publicState();
    sendJson(res, 200, state);
    return true;
  }

  if (path === "/api/app/ssh-comfy" && method === "PUT") {
    const record = body !== null && typeof body === "object" && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : null;
    if (record === null) {
      sendJson(res, 400, { message: BACKEND_MESSAGES.requestFailed });
      return true;
    }
    const saved = await deps.tunnel.save({
      host: record.host,
      port: record.port,
      username: record.username,
      remoteComfyPort: record.remoteComfyPort,
      secret: record.secret,
    });
    if (!saved.ok) {
      sendJson(res, 400, { message: saved.message });
      return true;
    }
    res.writeHead(204, { "Cache-Control": "no-store" });
    res.end();
    return true;
  }

  if (path === "/api/app/ssh-comfy" && method === "DELETE") {
    const removed = await deps.tunnel.remove();
    if (!removed.ok) {
      sendJson(res, 400, { message: removed.message });
      return true;
    }
    res.writeHead(204, { "Cache-Control": "no-store" });
    res.end();
    return true;
  }

  if (path === "/api/app/ssh-comfy/connect" && method === "POST") {
    const connected = await deps.tunnel.connect();
    if (!connected.ok) {
      sendJson(res, 400, { message: connected.message });
      return true;
    }
    const base = `http://127.0.0.1:${connected.localPort}`;
    const set = await deps.runtime.setComfyBaseUrl(base);
    if (!set.ok) {
      await deps.tunnel.disconnect();
      sendJson(res, 400, { message: set.message.length > 0 ? set.message : USER_FACING.comfyUnreachable });
      return true;
    }
    res.writeHead(204, { "Cache-Control": "no-store" });
    res.end();
    return true;
  }

  if (path === "/api/app/ssh-comfy/disconnect" && method === "POST") {
    await deps.tunnel.disconnect();
    res.writeHead(204, { "Cache-Control": "no-store" });
    res.end();
    return true;
  }

  return false;
}

export async function handleUseLocalComfy(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  body: unknown,
  deps: { dataDir: string; runtime: ExecutionRuntime },
): Promise<boolean> {
  const method = (req.method ?? "GET").toUpperCase();
  const path = url.pathname;
  if (path !== "/api/app/use-local-comfy") {
    return false;
  }
  if (method === "GET") {
    sendJson(res, 200, { enabled: deps.runtime.getUseLocalComfy() });
    return true;
  }
  if (method === "PUT") {
    const record = body !== null && typeof body === "object" && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : null;
    if (record === null || typeof record.enabled !== "boolean") {
      sendJson(res, 400, { message: BACKEND_MESSAGES.requestFailed });
      return true;
    }
    await writeUseLocalComfy(deps.dataDir, record.enabled);
    deps.runtime.setUseLocalComfy(record.enabled);
    res.writeHead(204, { "Cache-Control": "no-store" });
    res.end();
    return true;
  }
  return false;
}
