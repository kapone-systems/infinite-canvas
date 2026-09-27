import type { IncomingMessage, ServerResponse } from "node:http";
import type { FfmpegProbeResult } from "../ffmpegStatus.ts";
import { sendJson } from "./guard.ts";

export type ComfyHealth = "unconfigured" | "ok" | "unreachable";

export type HealthBody = {
  ok: true;
  ffmpeg: "missing" | "ok";
  ffprobe: "missing" | "ok";
  ffmpegVersion: string | null;
  comfy: ComfyHealth;
  secretStore: "not-checked";
};

export function buildHealthBody(ffmpeg: FfmpegProbeResult, comfy: ComfyHealth = "unconfigured"): HealthBody {
  return {
    ok: true,
    ffmpeg: ffmpeg.ffmpeg,
    ffprobe: ffmpeg.ffprobe,
    ffmpegVersion: ffmpeg.ffmpegVersion,
    comfy,
    secretStore: "not-checked",
  };
}

export function handleHealth(
  req: IncomingMessage,
  res: ServerResponse,
  ffmpeg: FfmpegProbeResult,
  comfy: ComfyHealth = "unconfigured",
): boolean {
  const method = (req.method ?? "GET").toUpperCase();
  if (method !== "GET") {
    return false;
  }
  sendJson(res, 200, buildHealthBody(ffmpeg, comfy));
  return true;
}
