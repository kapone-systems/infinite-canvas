/**
 * 音频时长只读 ffprobe。参数数组，shell: false，不经过 cmd /c。
 * 读不到、退出非 0、或没有 ffprobe：durationMs 为 null，不抛。
 * 不要走 deriveVideoWithFfmpeg：那条会改 kind、写首帧、尾帧、封面和代理。
 */
import { spawn } from "node:child_process";
import { probeFfmpegFfprobe } from "../ffmpegStatus.ts";
import { FFMPEG_MAX_RUN_MS } from "./videoDerive.ts";

/** 方案第 9.3 节拟定 ffprobe。用户原文件名不进参数。 */
export function audioProbeArgv(inputPath: string): string[] {
  return ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", inputPath];
}

function runFfprobe(
  bin: string,
  args: string[],
  timeoutMs: number,
): Promise<{ code: number | null; stdout: string } | null> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: { code: number | null; stdout: string } | null): void => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(value);
    };
    let child;
    try {
      child = spawn(bin, args, {
        shell: false,
        windowsHide: true,
        stdio: ["ignore", "pipe", "ignore"],
      });
    } catch {
      finish(null);
      return;
    }
    let stdout = "";
    const timer = setTimeout(() => {
      child.kill();
      finish(null);
    }, timeoutMs);
    child.stdout?.on("data", (chunk: Buffer | string) => {
      stdout += chunk.toString();
    });
    child.on("error", () => {
      clearTimeout(timer);
      finish(null);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      finish({ code, stdout });
    });
  });
}

function durationFromProbe(stdout: string): { durationMs: number | null; durationRaw: string | null } {
  try {
    const parsed = JSON.parse(stdout) as { format?: { duration?: unknown } };
    const raw = parsed.format?.duration;
    if (typeof raw !== "string" || raw.trim().length === 0) {
      return { durationMs: null, durationRaw: null };
    }
    const seconds = Number(raw);
    if (!Number.isFinite(seconds) || seconds <= 0) {
      return { durationMs: null, durationRaw: raw };
    }
    return { durationMs: Math.round(seconds * 1000), durationRaw: raw };
  } catch {
    return { durationMs: null, durationRaw: null };
  }
}

export async function probeAudioDuration(input: {
  filePath: string;
  ffprobePath?: string | null;
  timeoutMs?: number;
}): Promise<{ durationMs: number | null; durationRaw: string | null }> {
  const empty = { durationMs: null, durationRaw: null };
  const status = await probeFfmpegFfprobe({
    ffprobePath: input.ffprobePath,
    timeoutMs: 1500,
  });
  if (status.ffprobe !== "ok") {
    return empty;
  }
  const bin = input.ffprobePath && input.ffprobePath.length > 0 ? input.ffprobePath : "ffprobe";
  const ran = await runFfprobe(bin, audioProbeArgv(input.filePath), input.timeoutMs ?? FFMPEG_MAX_RUN_MS);
  if (ran === null || ran.code !== 0) {
    return empty;
  }
  return durationFromProbe(ran.stdout);
}
