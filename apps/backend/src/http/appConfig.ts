import type { IncomingMessage, ServerResponse } from "node:http";
import { USER_FACING } from "@canvas/schema";
import { parseLocalComfyBaseUrl } from "../execution/comfy/client.ts";
import type { ExecutionRuntime } from "../execution/runtime.ts";
import type { FfmpegProbeResult } from "../ffmpegStatus.ts";
import { BACKEND_MESSAGES } from "../messages.ts";
import { sendJson } from "./guard.ts";

export async function handleAppConfig(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  body: unknown,
  runtime: ExecutionRuntime,
  ffmpeg: FfmpegProbeResult,
  disconnectTunnel?: () => Promise<void>,
): Promise<boolean> {
  const method = (req.method ?? "GET").toUpperCase();
  const path = url.pathname;

  if (path === "/api/app/config" && method === "GET") {
    sendJson(res, 200, {
      comfyBaseUrl: runtime.getComfyBaseUrl(),
      ffmpeg: ffmpeg.ffmpeg,
      ffprobe: ffmpeg.ffprobe,
      ffmpegVersion: ffmpeg.ffmpegVersion,
    });
    return true;
  }

  if (path === "/api/app/comfy-base-url" && method === "PUT") {
    const record = body !== null && typeof body === "object" && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : null;
    if (record === null || !("comfyBaseUrl" in record)) {
      sendJson(res, 400, { message: USER_FACING.comfyUnconfigured });
      return true;
    }
    const parsed = parseLocalComfyBaseUrl(record.comfyBaseUrl);
    if (!parsed.ok) {
      sendJson(res, 400, { message: BACKEND_MESSAGES.requestFailed });
      return true;
    }
    if (disconnectTunnel !== undefined) {
      await disconnectTunnel();
    }
    const result = await runtime.setComfyBaseUrl(record.comfyBaseUrl);
    if (!result.ok) {
      sendJson(res, 400, { message: result.message });
      return true;
    }
    res.writeHead(204, { "Cache-Control": "no-store" });
    res.end();
    return true;
  }

  return false;
}
