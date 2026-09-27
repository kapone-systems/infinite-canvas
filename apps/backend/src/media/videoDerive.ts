/**
 * 方案第 9.3 节拟定 ffmpeg。参数数组，shell: false。
 * 找不到 ffmpeg / ffprobe 是普通状态，不抛。frameAccuracy 保持 unverified，本文件不声称尾帧已核实。
 */
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { blobRelPath, type MediaRef } from "@canvas/schema";
import { probeFfmpegFfprobe } from "../ffmpegStatus.ts";
import { absFromRel, derivedRelPath } from "./layout.ts";

export const FRAME_ACCURACY = "unverified" as const;

/** 方案 app.json 的 ffmpegMaxRunMs。未配置时用 30 分钟，不要写死成几秒。 */
export const FFMPEG_MAX_RUN_MS = 30 * 60 * 1000;

export const POSTER_WEBP_LONGEDGE_1280_V1 = "poster-webp-longedge-1280-v1";
export const FRAME_PNG_NATIVE_V1 = "frame-png-native-v1";
export const PROXY_H264_LONGEDGE_1280_V1 = "proxy-h264-longedge-1280-v1";

export type DeriveArgv = { bin: "ffmpeg" | "ffprobe"; args: string[] };

/** 用户原文件名不进参数。调用方传媒体库绝对路径。 */
export function videoDeriveArgv(
  inputPath: string,
  outs: { first: string; last: string; cover: string; proxy: string },
): DeriveArgv[] {
  return [
    {
      bin: "ffprobe",
      args: ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", inputPath],
    },
    { bin: "ffmpeg", args: ["-y", "-i", inputPath, "-update", "1", "-frames:v", "1", outs.first] },
    // ffmpeg 9 上 -sseof -0.1 会退出 0 但写出空文件。改成从结尾回退 1 秒，短片仍能落到一帧。尾帧精度保持 unverified。
    { bin: "ffmpeg", args: ["-y", "-sseof", "-1", "-i", inputPath, "-update", "1", "-frames:v", "1", outs.last] },
    {
      bin: "ffmpeg",
      args: [
        "-y",
        "-i",
        outs.first,
        "-vf",
        "scale=w='min(1280,iw)':h='min(1280,ih)':force_original_aspect_ratio=decrease",
        "-update",
        "1",
        "-frames:v",
        "1",
        "-quality",
        "80",
        outs.cover,
      ],
    },
    {
      bin: "ffmpeg",
      args: [
        "-y",
        "-i",
        inputPath,
        "-map",
        "0:v:0",
        "-map",
        "0:a?",
        "-vf",
        "scale=w=1280:h=1280:force_original_aspect_ratio=decrease:force_divisible_by=2",
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        "-crf",
        "23",
        "-preset",
        "veryfast",
        "-c:a",
        "aac",
        "-b:a",
        "128k",
        "-movflags",
        "+faststart",
        outs.proxy,
      ],
    },
  ];
}

function runArgv(bin: string, args: string[], timeoutMs: number): Promise<{ code: number | null; stdout: string } | null> {
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

function durationMsFromProbe(stdout: string): number | null {
  try {
    const parsed = JSON.parse(stdout) as { format?: { duration?: string } };
    const raw = parsed.format?.duration;
    if (raw === undefined) {
      return null;
    }
    const seconds = Number(raw);
    if (!Number.isFinite(seconds) || seconds <= 0) {
      return null;
    }
    return Math.round(seconds * 1000);
  } catch {
    return null;
  }
}

async function storeDerived(projectRoot: string, sourceSha256: string, recipeId: string, filePath: string, ext: string): Promise<string | null> {
  let bytes: Buffer;
  try {
    bytes = await readFile(filePath);
  } catch {
    return null;
  }
  if (bytes.byteLength === 0) {
    return null;
  }
  const sha = createHash("sha256").update(bytes).digest("hex");
  const rel = derivedRelPath(sourceSha256, recipeId, sha, ext);
  const abs = absFromRel(projectRoot, rel);
  await mkdir(join(abs, ".."), { recursive: true });
  await writeFile(abs, bytes);
  return rel;
}

export async function deriveVideoWithFfmpeg(input: {
  projectRoot: string;
  media: MediaRef;
  ffmpegPath?: string | null;
  ffprobePath?: string | null;
  timeoutMs?: number;
}): Promise<{ ok: true; media: MediaRef } | { ok: false }> {
  const sha = input.media.contentHash;
  if (sha === null || sha.length === 0) {
    return { ok: false };
  }
  const probe = await probeFfmpegFfprobe({
    ffmpegPath: input.ffmpegPath,
    ffprobePath: input.ffprobePath,
    timeoutMs: 1500,
  });
  if (probe.ffmpeg !== "ok" || probe.ffprobe !== "ok") {
    return { ok: false };
  }
  const ffmpeg = input.ffmpegPath && input.ffmpegPath.length > 0 ? input.ffmpegPath : "ffmpeg";
  const ffprobe = input.ffprobePath && input.ffprobePath.length > 0 ? input.ffprobePath : "ffprobe";
  const sourceAbs = absFromRel(input.projectRoot, input.media.relativePath || blobRelPath(sha));
  const stamp = `${process.pid}-${Date.now()}`;
  const first = join(tmpdir(), `canvas-first-${stamp}.png`);
  const last = join(tmpdir(), `canvas-last-${stamp}.png`);
  const cover = join(tmpdir(), `canvas-cover-${stamp}.webp`);
  const proxy = join(tmpdir(), `canvas-proxy-${stamp}.mp4`);
  const commands = videoDeriveArgv(sourceAbs, { first, last, cover, proxy });
  const timeoutMs = input.timeoutMs ?? FFMPEG_MAX_RUN_MS;
  let durationMs: number | null = null;
  for (const command of commands) {
    const bin = command.bin === "ffprobe" ? ffprobe : ffmpeg;
    const ran = await runArgv(bin, command.args, timeoutMs);
    if (ran === null || ran.code !== 0) {
      return { ok: false };
    }
    if (command.bin === "ffprobe") {
      durationMs = durationMsFromProbe(ran.stdout);
    }
  }
  if (durationMs === null) {
    return { ok: false };
  }
  const firstRel = await storeDerived(input.projectRoot, sha, FRAME_PNG_NATIVE_V1, first, "png");
  const lastRel = await storeDerived(input.projectRoot, sha, FRAME_PNG_NATIVE_V1, last, "png");
  const coverRel = await storeDerived(input.projectRoot, sha, POSTER_WEBP_LONGEDGE_1280_V1, cover, "webp");
  const proxyRel = await storeDerived(input.projectRoot, sha, PROXY_H264_LONGEDGE_1280_V1, proxy, "mp4");
  if (firstRel === null || lastRel === null || coverRel === null || proxyRel === null) {
    return { ok: false };
  }
  return {
    ok: true,
    media: {
      ...input.media,
      kind: "video",
      durationMs,
      firstFrameRelativePath: firstRel,
      lastFrameRelativePath: lastRel,
      coverRelativePath: coverRel,
      proxyRelativePath: proxyRel,
    },
  };
}
