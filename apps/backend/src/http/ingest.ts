/**
 * POST /api/projects/current/media/ingest
 * 字段必须叫 file（方案 9.9）。先入库，不建节点。必须在 JSON 读体之前吃原始 req 流。
 */
import { randomUUID } from "node:crypto";
import { createWriteStream, existsSync } from "node:fs";
import { mkdir, unlink } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { dirname } from "node:path";
import { USER_FACING } from "@canvas/schema";
import { readAppJsonSync } from "../appData.ts";
import { headerValue, sendJson } from "./guard.ts";
import type { ProjectSession } from "../project/workingCopy.ts";
import { absFromRel, incomingPartRelPath, MAX_INGEST_BYTES } from "../media/layout.ts";
import { finalizePart } from "../media/ingest.ts";

export const MEDIA_INGEST_PATH = "/api/projects/current/media/ingest";
export const MEDIA_INGEST_FIELD = "file";

function parseBoundary(contentType: string): string | null {
  const match = /boundary\s*=\s*(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  if (match === null) {
    return null;
  }
  const raw = (match[1] ?? match[2] ?? "").trim();
  return raw.length > 0 ? raw : null;
}

function parseDisposition(value: string): { name: string | null; filename: string | null } {
  const nameMatch = /(?:^|;)\s*name\s*=\s*(?:"([^"]*)"|([^;]+))/i.exec(value);
  const fileMatch = /(?:^|;)\s*filename\s*=\s*(?:"([^"]*)"|([^;]+))/i.exec(value);
  const name = (nameMatch?.[1] ?? nameMatch?.[2] ?? "").trim() || null;
  let filename = (fileMatch?.[1] ?? fileMatch?.[2] ?? "").trim() || null;
  if (filename !== null) {
    filename = filename.replace(/\\/g, "/").split("/").pop() ?? filename;
    if (filename === "" || filename === "." || filename === "..") {
      filename = null;
    } else {
      filename = filename.slice(0, 255);
    }
  }
  return { name, filename };
}

function headerMap(block: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of block.split("\r\n")) {
    const idx = line.indexOf(":");
    if (idx <= 0) {
      continue;
    }
    const key = line.slice(0, idx).trim().toLowerCase();
    out[key] = line.slice(idx + 1).trim();
  }
  return out;
}

async function safeUnlink(abs: string): Promise<void> {
  try {
    await unlink(abs);
  } catch {
    /* ignore */
  }
}

type FilePart = {
  partAbs: string;
  originalFileName: string | null;
  byteSize: number;
};

type MultipartFail = { ok: false; status: 400 | 413; message: string };
type MultipartOk = { ok: true; file: FilePart | null };

function concat(a: Buffer, b: Buffer): Buffer {
  const out = Buffer.alloc(a.length + b.length);
  a.copy(out, 0);
  b.copy(out, a.length);
  return out;
}

function chunkToBuffer(chunk: Buffer | string): Buffer {
  if (typeof chunk === "string") {
    return Buffer.from(chunk, "utf8");
  }
  const out = Buffer.alloc(chunk.length);
  chunk.copy(out);
  return out;
}

async function readMultipartFile(
  req: IncomingMessage,
  input: { projectRoot: string; taskId: string; boundary: string; maxBytes: number },
): Promise<MultipartOk | MultipartFail> {
  const dashBoundary = Buffer.from(`--${input.boundary}`);
  const crlfDashBoundary = Buffer.from(`\r\n--${input.boundary}`);
  const headerSep = Buffer.from("\r\n\r\n");
  const partRel = incomingPartRelPath(input.taskId);
  const partAbs = absFromRel(input.projectRoot, partRel);
  await mkdir(dirname(partAbs), { recursive: true });

  let pending: Buffer = Buffer.alloc(0);
  let mode: "preamble" | "headers" | "file" | "skip" | "done" = "preamble";
  let write: ReturnType<typeof createWriteStream> | null = null;
  let byteSize = 0;
  let originalFileName: string | null = null;
  let sawFile = false;
  let tooLarge = false;
  let writeError: Error | null = null;

  const openWrite = (): void => {
    write = createWriteStream(partAbs);
    write.on("error", (err) => {
      writeError = err;
    });
  };

  const closeWrite = async (): Promise<void> => {
    if (write === null) {
      return;
    }
    const stream = write;
    write = null;
    await new Promise<void>((resolve, reject) => {
      stream.end(() => resolve());
      stream.on("error", reject);
    });
  };

  const writeChunk = (chunk: Buffer): void => {
    if (write === null || tooLarge || writeError !== null) {
      return;
    }
    if (byteSize + chunk.length > input.maxBytes) {
      tooLarge = true;
      req.destroy();
      streamDestroy(write);
      write = null;
      return;
    }
    byteSize += chunk.length;
    write.write(chunk);
  };

  const processPending = (): void => {
    while (mode !== "done" && pending.length > 0) {
      if (mode === "preamble") {
        const idx = pending.indexOf(dashBoundary);
        if (idx < 0) {
          if (pending.length > dashBoundary.length) {
            pending = pending.subarray(pending.length - dashBoundary.length);
          }
          return;
        }
        pending = pending.subarray(idx + dashBoundary.length);
        if (pending.length >= 2 && pending[0] === 0x2d && pending[1] === 0x2d) {
          mode = "done";
          return;
        }
        if (pending.length >= 2 && pending[0] === 0x0d && pending[1] === 0x0a) {
          pending = pending.subarray(2);
        }
        mode = "headers";
        continue;
      }
      if (mode === "headers") {
        const idx = pending.indexOf(headerSep);
        if (idx < 0) {
          return;
        }
        const headerText = pending.subarray(0, idx).toString("utf8");
        pending = pending.subarray(idx + headerSep.length);
        const headers = headerMap(headerText);
        const disp = parseDisposition(headers["content-disposition"] ?? "");
        if (disp.name === MEDIA_INGEST_FIELD && !sawFile) {
          sawFile = true;
          originalFileName = disp.filename;
          openWrite();
          mode = "file";
        } else {
          mode = "skip";
        }
        continue;
      }
      const marker = crlfDashBoundary;
      const idx = pending.indexOf(marker);
      if (idx >= 0) {
        const body = pending.subarray(0, idx);
        if (mode === "file") {
          writeChunk(body);
        }
        pending = pending.subarray(idx + 2);
        mode = "preamble";
        continue;
      }
      const keep = marker.length;
      if (pending.length > keep) {
        const emit = pending.subarray(0, pending.length - keep);
        if (mode === "file") {
          writeChunk(emit);
        }
        pending = pending.subarray(pending.length - keep);
      }
      return;
    }
  };

  try {
    await new Promise<void>((resolve, reject) => {
      req.on("data", (chunk: Buffer | string) => {
        if (tooLarge) {
          return;
        }
        pending = concat(pending, chunkToBuffer(chunk)) as Buffer;
        try {
          processPending();
        } catch (err) {
          reject(err);
        }
      });
      req.on("end", () => {
        try {
          processPending();
          resolve();
        } catch (err) {
          reject(err);
        }
      });
      req.on("error", reject);
      req.on("aborted", () => {
        reject(Object.assign(new Error("aborted"), { code: "ABORTED" }));
      });
    });
    await closeWrite();
  } catch {
    await closeWrite().catch(() => undefined);
    await safeUnlink(partAbs);
    if (tooLarge) {
      return { ok: false, status: 413, message: USER_FACING.ingestTooLarge };
    }
    return { ok: false, status: 400, message: USER_FACING.ingestFailed };
  }

  if (tooLarge) {
    await safeUnlink(partAbs);
    return { ok: false, status: 413, message: USER_FACING.ingestTooLarge };
  }
  if (writeError !== null) {
    await safeUnlink(partAbs);
    return { ok: false, status: 400, message: USER_FACING.ingestFailed };
  }
  if (!sawFile || !existsSync(partAbs) || byteSize <= 0) {
    await safeUnlink(partAbs);
    return { ok: false, status: 400, message: USER_FACING.ingestFailed };
  }
  return {
    ok: true,
    file: { partAbs, originalFileName, byteSize },
  };
}

function streamDestroy(stream: ReturnType<typeof createWriteStream>): void {
  stream.destroy();
}

export async function handleMediaIngest(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  ctx: { session: ProjectSession; now?: () => Date; dataDir?: string },
): Promise<boolean> {
  if (url.pathname !== MEDIA_INGEST_PATH) {
    return false;
  }
  const method = (req.method ?? "GET").toUpperCase();
  if (method !== "POST") {
    return false;
  }
  if (ctx.session.current === null) {
    sendJson(res, 404, { message: USER_FACING.noProject });
    req.resume();
    return true;
  }
  const contentType = headerValue(req.headers["content-type"]) ?? "";
  if (!contentType.toLowerCase().includes("multipart/form-data")) {
    sendJson(res, 400, { message: USER_FACING.ingestFailed });
    req.resume();
    return true;
  }
  const boundary = parseBoundary(contentType);
  if (boundary === null) {
    sendJson(res, 400, { message: USER_FACING.ingestFailed });
    req.resume();
    return true;
  }
  const taskId = randomUUID();
  const parsed = await readMultipartFile(req, {
    projectRoot: ctx.session.current.absolutePath,
    taskId,
    boundary,
    maxBytes: MAX_INGEST_BYTES,
  });
  if (!parsed.ok) {
    sendJson(res, parsed.status, { message: parsed.message });
    return true;
  }
  if (parsed.file === null) {
    sendJson(res, 400, { message: USER_FACING.ingestFailed });
    return true;
  }
  const stored = ctx.dataDir !== undefined ? readAppJsonSync(ctx.dataDir) : {};
  const result = await finalizePart({
    projectRoot: ctx.session.current.absolutePath,
    partAbs: parsed.file.partAbs,
    originalFileName: parsed.file.originalFileName,
    source: "import",
    taskId,
    now: ctx.now ?? (() => new Date()),
    makeThumb: true,
    ffmpegPath: stored.ffmpegPath,
    ffprobePath: stored.ffprobePath,
    ffmpegMaxRunMs: stored.ffmpegMaxRunMs,
  });
  if (!result.ok) {
    sendJson(res, result.status, { message: result.message });
    return true;
  }
  sendJson(res, 201, { media: result.media });
  return true;
}
