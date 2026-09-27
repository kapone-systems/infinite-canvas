/**
 * 方案第 9.3 / 9.9 节：incoming part → SHA-256 → media/blobs/<前两位>/<hash>.blob。
 * 相同哈希复用。SVG 与超 2GiB 拒绝。缩略图失败不改原件。
 * wav / mp3 / flac 按魔数入库，不生成封面、首帧、尾帧、代理。
 * 时长只读 ffprobe；读不到时原件仍在，durationMs 为 null。
 * 不要在 pointermove 路径调用。
 */
import { createHash, randomUUID } from "node:crypto";
import { createReadStream, existsSync } from "node:fs";
import { mkdir, open, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { pipeline } from "node:stream/promises";
import { blobRelPath, USER_FACING, type MediaRef } from "@canvas/schema";
import { BACKEND_MESSAGES } from "../messages.ts";
import { isErrno } from "../project/atomicWrite.ts";
import {
  absFromRel,
  incomingPartRelPath,
  MAX_INGEST_BYTES,
  sidecarRelPath,
} from "./layout.ts";
import { probeAudioDuration } from "./audioDuration.ts";
import { PREVIEW_IMAGE_MAGICS, sniffMagic, type SniffResult } from "./magic.ts";
import { deriveThumbWebp } from "./thumb.ts";
import { deriveVideoWithFfmpeg } from "./videoDerive.ts";

export type BlobSidecar = {
  sha256: string;
  byteSize: number;
  mimeDetected: string;
  kind: "image" | "video" | "audio" | "text-file" | "unknown";
  originalFileName: string | null;
  importedAt: string;
  source: "import" | "generation";
  taskId: string | null;
  sniff: { matched: boolean; magic: string | null };
  durationRaw: string | null;
};

export type IngestOk = {
  ok: true;
  media: MediaRef;
  reused: boolean;
  thumb: "ready" | "failed";
  sidecar: BlobSidecar;
};

export type IngestFail = {
  ok: false;
  status: 400 | 413 | 507;
  code: "svg" | "too-large" | "unsupported" | "failed" | "disk-full" | "hash-mismatch";
  message: string;
};

export type IngestResult = IngestOk | IngestFail;

export type IngestBytesInput = {
  projectRoot: string;
  bytes: Uint8Array;
  originalFileName?: string | null;
  source?: "import" | "generation";
  taskId?: string | null;
  now?: () => Date;
  maxBytes?: number;
  makeThumb?: boolean;
  ffmpegPath?: string | null;
  ffprobePath?: string | null;
  ffmpegMaxRunMs?: number;
};

function fail(status: IngestFail["status"], code: IngestFail["code"], message: string): IngestFail {
  return { ok: false, status, code, message };
}

function mapFsError(err: unknown): IngestFail {
  if (isErrno(err, "ENOSPC")) {
    return fail(507, "disk-full", BACKEND_MESSAGES.diskFull);
  }
  return fail(400, "failed", USER_FACING.ingestFailed);
}

const THUMB_SOURCE_MAX_BYTES = 64 * 1024 * 1024;

async function readHead(abs: string, n: number): Promise<Buffer> {
  const fh = await open(abs, "r");
  try {
    const buf = Buffer.alloc(n);
    const { bytesRead } = await fh.read(buf, 0, n, 0);
    return buf.subarray(0, bytesRead);
  } finally {
    await fh.close();
  }
}

async function hashFile(abs: string): Promise<string> {
  const hash = createHash("sha256");
  await pipeline(createReadStream(abs), hash);
  return hash.digest("hex");
}

async function retryRename(from: string, to: string): Promise<void> {
  let last: unknown;
  for (let i = 0; i < 6; i += 1) {
    try {
      await rename(from, to);
      return;
    } catch (err) {
      last = err;
      if (isErrno(err, "EEXIST")) {
        throw err;
      }
      if (!isErrno(err, "EBUSY") && !isErrno(err, "EPERM") && !isErrno(err, "EACCES")) {
        throw err;
      }
      await new Promise((resolve) => setTimeout(resolve, 20 * (i + 1)));
    }
  }
  throw last;
}

async function safeUnlink(abs: string): Promise<void> {
  try {
    await unlink(abs);
  } catch {
    /* ignore */
  }
}

function mediaFrom(
  sha256: string,
  byteSize: number,
  sniff: SniffResult,
  thumbRelativePath: string | null,
  thumbSize: { width: number; height: number } | null,
  kind: "image" | "video" | "audio" = "image",
): MediaRef {
  const width = thumbSize?.width ?? sniff.width;
  const height = thumbSize?.height ?? sniff.height;
  return {
    kind,
    relativePath: blobRelPath(sha256),
    contentHash: sha256,
    byteSize,
    mimeDetected: sniff.mimeDetected,
    width,
    height,
    durationMs: null,
    firstFrameRelativePath: null,
    lastFrameRelativePath: null,
    coverRelativePath: null,
    proxyRelativePath: null,
    thumbRelativePath,
  };
}

async function writeSidecar(projectRoot: string, sidecar: BlobSidecar): Promise<void> {
  const rel = sidecarRelPath(sidecar.sha256);
  const abs = absFromRel(projectRoot, rel);
  if (existsSync(abs)) {
    return;
  }
  await mkdir(dirname(abs), { recursive: true });
  const tmp = `${abs}.${process.pid}.tmp`;
  await writeFile(tmp, `${JSON.stringify(sidecar, null, 2)}\n`, "utf8");
  try {
    await retryRename(tmp, abs);
  } catch (err) {
    await safeUnlink(tmp);
    if (existsSync(abs)) {
      return;
    }
    throw err;
  }
}

export async function ingestBytes(input: IngestBytesInput): Promise<IngestResult> {
  const maxBytes = input.maxBytes ?? MAX_INGEST_BYTES;
  if (input.bytes.byteLength > maxBytes) {
    return fail(413, "too-large", USER_FACING.ingestTooLarge);
  }
  const taskId = input.taskId ?? randomUUID();
  let partRel: string;
  try {
    partRel = incomingPartRelPath(taskId);
  } catch {
    return fail(400, "failed", USER_FACING.ingestFailed);
  }
  const partAbs = absFromRel(input.projectRoot, partRel);
  try {
    await mkdir(dirname(partAbs), { recursive: true });
    await writeFile(partAbs, input.bytes);
  } catch (err) {
    return mapFsError(err);
  }
  return finalizePart({
    projectRoot: input.projectRoot,
    partAbs,
    originalFileName: input.originalFileName ?? null,
    source: input.source ?? "import",
    taskId,
    now: input.now ?? (() => new Date()),
    makeThumb: input.makeThumb !== false,
    knownBytes: input.bytes,
    ffmpegPath: input.ffmpegPath,
    ffprobePath: input.ffprobePath,
    ffmpegMaxRunMs: input.ffmpegMaxRunMs,
  });
}

export async function finalizePart(input: {
  projectRoot: string;
  partAbs: string;
  originalFileName: string | null;
  source: "import" | "generation";
  taskId: string | null;
  now: () => Date;
  makeThumb: boolean;
  knownBytes?: Uint8Array;
  ffmpegPath?: string | null;
  ffprobePath?: string | null;
  ffmpegMaxRunMs?: number;
}): Promise<IngestResult> {
  let info;
  try {
    info = await stat(input.partAbs);
  } catch (err) {
    return mapFsError(err);
  }
  if (!info.isFile() || info.size <= 0) {
    await safeUnlink(input.partAbs);
    return fail(400, "failed", USER_FACING.ingestFailed);
  }
  const head =
    input.knownBytes !== undefined
      ? input.knownBytes.subarray(0, Math.min(input.knownBytes.byteLength, 1024))
      : await readHead(input.partAbs, 1024);
  const sniff = sniffMagic(head);
  if (sniff.svg || sniff.magic === "svg") {
    await safeUnlink(input.partAbs);
    return fail(400, "svg", USER_FACING.ingestSvg);
  }
  const isVideo = sniff.matched && (sniff.magic === "mp4" || sniff.magic === "webm");
  const isImage = sniff.matched && sniff.magic !== null && PREVIEW_IMAGE_MAGICS.has(sniff.magic);
  const isAudio = sniff.matched && sniff.kind === "audio";
  if (!isVideo && !isImage && !isAudio) {
    await safeUnlink(input.partAbs);
    return fail(400, "unsupported", USER_FACING.ingestFailed);
  }
  let sha256: string;
  try {
    sha256 = await hashFile(input.partAbs);
  } catch (err) {
    return mapFsError(err);
  }
  const blobRel = blobRelPath(sha256);
  const blobAbs = absFromRel(input.projectRoot, blobRel);
  let reused = false;
  try {
    await mkdir(dirname(blobAbs), { recursive: true });
    if (existsSync(blobAbs)) {
      const existing = await hashFile(blobAbs);
      if (existing !== sha256) {
        return fail(400, "hash-mismatch", BACKEND_MESSAGES.hashMismatch);
      }
      reused = true;
      await safeUnlink(input.partAbs);
    } else {
      await retryRename(input.partAbs, blobAbs);
    }
  } catch (err) {
    if (isErrno(err, "EEXIST")) {
      const existing = await hashFile(blobAbs);
      if (existing === sha256) {
        reused = true;
        await safeUnlink(input.partAbs);
      } else {
        return fail(400, "hash-mismatch", BACKEND_MESSAGES.hashMismatch);
      }
    } else {
      return mapFsError(err);
    }
  }
  let bytesForThumb: Uint8Array | null = input.knownBytes ?? null;
  if (bytesForThumb === null && !isAudio && info.size <= THUMB_SOURCE_MAX_BYTES) {
    bytesForThumb = new Uint8Array(await readFile(blobAbs));
  }
  let durationMs: number | null = null;
  let durationRaw: string | null = null;
  if (isAudio) {
    const probed = await probeAudioDuration({
      filePath: blobAbs,
      ffprobePath: input.ffprobePath,
      timeoutMs: input.ffmpegMaxRunMs,
    });
    durationMs = probed.durationMs;
    durationRaw = probed.durationRaw;
  }
  const sidecar: BlobSidecar = {
    sha256,
    byteSize: info.size,
    mimeDetected: sniff.mimeDetected ?? "application/octet-stream",
    kind: isVideo ? "video" : isAudio ? "audio" : "image",
    originalFileName: input.originalFileName,
    importedAt: input.now().toISOString(),
    source: input.source,
    taskId: input.taskId,
    sniff: { matched: sniff.matched, magic: sniff.magic },
    durationRaw,
  };
  try {
    await writeSidecar(input.projectRoot, sidecar);
  } catch (err) {
    return mapFsError(err);
  }
  let thumbRelativePath: string | null = null;
  let thumbStatus: "ready" | "failed" = "failed";
  let thumbSize: { width: number; height: number } | null = null;
  let media = mediaFrom(
    sha256,
    info.size,
    sniff,
    null,
    null,
    isVideo ? "video" : isAudio ? "audio" : "image",
  );
  if (isAudio) {
    media = { ...media, durationMs };
  }
  if (isVideo && input.makeThumb) {
    const derived = await deriveVideoWithFfmpeg({
      projectRoot: input.projectRoot,
      media,
      ffmpegPath: input.ffmpegPath,
      ffprobePath: input.ffprobePath,
      timeoutMs: input.ffmpegMaxRunMs,
    });
    if (derived.ok) {
      media = derived.media;
      thumbStatus = "ready";
    }
  } else if (!isVideo && !isAudio && input.makeThumb && bytesForThumb !== null) {
    const thumb = await deriveThumbWebp({
      projectRoot: input.projectRoot,
      sourceSha256: sha256,
      bytes: bytesForThumb,
    });
    if (thumb.ok) {
      thumbRelativePath = thumb.relativePath;
      thumbStatus = "ready";
      thumbSize = { width: thumb.width, height: thumb.height };
      media = mediaFrom(sha256, info.size, sniff, thumbRelativePath, thumbSize, "image");
    }
  }
  return {
    ok: true,
    media,
    reused,
    thumb: thumbStatus,
    sidecar,
  };
}
