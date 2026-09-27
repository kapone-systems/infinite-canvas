import { randomBytes } from "node:crypto";
import { createReadStream } from "node:fs";
import { realpath, stat, open } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { extname, isAbsolute, join, relative, resolve } from "node:path";
import { isValidProjectRelPath, USER_FACING } from "@canvas/schema";
import type { CanvasProjectFile, MediaRef } from "@canvas/schema";
import { BACKEND_MESSAGES } from "../messages.ts";
import { sniffMagic } from "../media/magic.ts";
import type { ProjectSession } from "../project/workingCopy.ts";
import { headerValue, isMediaTicketGetPath, sendJson } from "./guard.ts";

/** 方案第 9.3 节选定有效期。 */
export const MEDIA_TICKET_TTL_MS = 10 * 60 * 1000;

/**
 * 方案第 9.3 节是 thumb / cover / proxy / original。
 * audio 只签发给 kind 为 audio 的原件，给画布播放。不把 original 当播放，也不走视频代理。
 */
export const MEDIA_TICKET_PURPOSES = ["thumb", "cover", "proxy", "original", "audio"] as const;
export type MediaTicketPurpose = (typeof MEDIA_TICKET_PURPOSES)[number];

export type MediaTicket = {
  ticketId: string;
  relativePath: string;
  purpose: MediaTicketPurpose;
  projectDir: string;
  expiresAtMs: number;
};

const MIME_BY_EXT: Record<string, string> = {
  ".blob": "application/octet-stream",
  ".flac": "audio/flac",
  ".gif": "image/gif",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".mp3": "audio/mpeg",
  ".mp4": "video/mp4",
  ".png": "image/png",
  ".wav": "audio/wav",
  ".webm": "video/webm",
  ".webp": "image/webp",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isPurpose(value: unknown): value is MediaTicketPurpose {
  return typeof value === "string" && (MEDIA_TICKET_PURPOSES as readonly string[]).includes(value);
}

function addPurpose(map: Map<string, Set<MediaTicketPurpose>>, path: string | null, purpose: MediaTicketPurpose): void {
  if (path === null || path.length === 0) {
    return;
  }
  let roles = map.get(path);
  if (roles === undefined) {
    roles = new Set<MediaTicketPurpose>();
    map.set(path, roles);
  }
  roles.add(purpose);
}

function addMediaRef(map: Map<string, Set<MediaTicketPurpose>>, ref: MediaRef | null | undefined): void {
  if (ref === null || ref === undefined) {
    return;
  }
  addPurpose(map, ref.relativePath, "original");
  if (ref.kind === "audio") {
    addPurpose(map, ref.relativePath, "audio");
  }
  addPurpose(map, ref.thumbRelativePath, "thumb");
  addPurpose(map, ref.coverRelativePath, "cover");
  addPurpose(map, ref.proxyRelativePath, "proxy");
  addPurpose(map, ref.firstFrameRelativePath, "thumb");
  addPurpose(map, ref.lastFrameRelativePath, "thumb");
}

/** 当前工作副本里被引用的 media 路径及角色（含变体输出）。 */
export function referencedMediaPurposes(project: CanvasProjectFile): Map<string, Set<MediaTicketPurpose>> {
  const map = new Map<string, Set<MediaTicketPurpose>>();
  for (const node of Object.values(project.nodes)) {
    addMediaRef(map, node.output);
    if (node.versions === undefined) {
      continue;
    }
    for (const version of node.versions) {
      for (const variant of version.variants) {
        addMediaRef(map, variant.output);
      }
    }
  }
  return map;
}

export function isIssuableMediaRelPath(relativePath: string): boolean {
  if (!isValidProjectRelPath(relativePath)) {
    return false;
  }
  return relativePath.startsWith("media/blobs/") || relativePath.startsWith("media/derived/");
}

function isInsideRoot(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  if (rel === "") {
    return true;
  }
  return !rel.startsWith("..") && !isAbsolute(rel);
}

async function resolveMediaFile(projectDir: string, relativePath: string): Promise<string | null> {
  if (!isIssuableMediaRelPath(relativePath)) {
    return null;
  }
  let root: string;
  try {
    root = await realpath(projectDir);
  } catch {
    return null;
  }
  const candidate = resolve(join(root, ...relativePath.split("/")));
  if (!isInsideRoot(root, candidate)) {
    return null;
  }
  try {
    const real = await realpath(candidate);
    if (!isInsideRoot(root, real)) {
      return null;
    }
    const info = await stat(real);
    return info.isFile() ? real : null;
  } catch {
    return null;
  }
}

export class MediaTicketStore {
  private readonly tickets = new Map<string, MediaTicket>();
  private readonly now: () => Date;

  constructor(now: () => Date) {
    this.now = now;
  }

  issue(input: {
    relativePath: string;
    purpose: MediaTicketPurpose;
    projectDir: string;
  }): { ticketId: string; expiresAt: string } {
    this.purgeExpired();
    const ticketId = randomBytes(18).toString("base64url");
    const expiresAtMs = this.now().getTime() + MEDIA_TICKET_TTL_MS;
    this.tickets.set(ticketId, {
      ticketId,
      relativePath: input.relativePath,
      purpose: input.purpose,
      projectDir: input.projectDir,
      expiresAtMs,
    });
    return { ticketId, expiresAt: new Date(expiresAtMs).toISOString() };
  }

  /**
   * 只在开始发送前调用。命中后把记录交给调用方，发送过程中不再查过期，以免掐断。
   */
  lookupActive(ticketId: string): MediaTicket | null {
    const ticket = this.tickets.get(ticketId);
    if (ticket === undefined) {
      return null;
    }
    if (this.now().getTime() >= ticket.expiresAtMs) {
      this.tickets.delete(ticketId);
      return null;
    }
    return ticket;
  }

  private purgeExpired(): void {
    const nowMs = this.now().getTime();
    for (const [id, ticket] of this.tickets) {
      if (nowMs >= ticket.expiresAtMs) {
        this.tickets.delete(id);
      }
    }
  }
}

type ByteRange =
  | { type: "all" }
  | { type: "part"; start: number; end: number }
  | { type: "unsatisfiable" };

export function parseByteRange(header: string | undefined, size: number): ByteRange {
  if (header === undefined || header.trim().length === 0) {
    return { type: "all" };
  }
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (match === null) {
    return { type: "unsatisfiable" };
  }
  const startTok = match[1] ?? "";
  const endTok = match[2] ?? "";
  if (startTok === "" && endTok === "") {
    return { type: "unsatisfiable" };
  }
  if (size <= 0) {
    return { type: "unsatisfiable" };
  }
  if (startTok === "") {
    const suffix = Number(endTok);
    if (!Number.isInteger(suffix) || suffix <= 0) {
      return { type: "unsatisfiable" };
    }
    const start = Math.max(0, size - suffix);
    return { type: "part", start, end: size - 1 };
  }
  const start = Number(startTok);
  if (!Number.isInteger(start) || start < 0 || start >= size) {
    return { type: "unsatisfiable" };
  }
  if (endTok === "") {
    return { type: "part", start, end: size - 1 };
  }
  const end = Number(endTok);
  if (!Number.isInteger(end) || end < start) {
    return { type: "unsatisfiable" };
  }
  return { type: "part", start, end: Math.min(end, size - 1) };
}

function mimeFor(filePath: string): string {
  const ext = extname(filePath).toLowerCase();
  return MIME_BY_EXT[ext] ?? "application/octet-stream";
}

/** 音频原件扩展名是 .blob。只在 purpose=audio 时按入库魔数回类型，不改 thumb / proxy / original。 */
async function audioMimeFromMagic(filePath: string): Promise<string> {
  let fh: Awaited<ReturnType<typeof open>> | null = null;
  try {
    fh = await open(filePath, "r");
    const buf = Buffer.alloc(64);
    const { bytesRead } = await fh.read(buf, 0, 64, 0);
    const sniff = sniffMagic(buf.subarray(0, bytesRead));
    if (sniff.magic === "wav" || sniff.magic === "mp3" || sniff.magic === "flac") {
      return sniff.mimeDetected ?? "application/octet-stream";
    }
    return "application/octet-stream";
  } catch {
    return "application/octet-stream";
  } finally {
    await fh?.close();
  }
}

function sendExpired(res: ServerResponse): void {
  sendJson(res, 403, { message: USER_FACING.ticketExpired });
}

function pipeFile(
  req: IncomingMessage,
  res: ServerResponse,
  filePath: string,
  size: number,
  range: Exclude<ByteRange, { type: "unsatisfiable" }>,
  mime: string,
): Promise<void> {
  const start = range.type === "all" ? 0 : range.start;
  const end = range.type === "all" ? Math.max(0, size - 1) : range.end;
  const length = size === 0 ? 0 : end - start + 1;
  const headers: Record<string, string | number> = {
    "Content-Type": mime,
    "Content-Length": length,
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, max-age=600",
    "X-Content-Type-Options": "nosniff",
  };
  const status = range.type === "part" ? 206 : 200;
  if (range.type === "part") {
    headers["Content-Range"] = `bytes ${start}-${end}/${size}`;
  }
  res.writeHead(status, headers);
  if ((req.method ?? "GET").toUpperCase() === "HEAD" || length === 0) {
    res.end();
    return Promise.resolve();
  }
  const stream = createReadStream(filePath, size === 0 ? undefined : { start, end });
  return new Promise((resolvePromise) => {
    const done = (): void => {
      resolvePromise();
    };
    stream.on("error", () => {
      if (!res.writableEnded) {
        res.destroy();
      }
      done();
    });
    res.on("finish", done);
    res.on("close", done);
    stream.pipe(res);
  });
}

export async function handleMediaTicketGet(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  ctx: { session: ProjectSession; tickets: MediaTicketStore },
): Promise<boolean> {
  const method = (req.method ?? "GET").toUpperCase();
  if (method !== "GET" && method !== "HEAD") {
    return false;
  }
  if (!isMediaTicketGetPath(url.pathname)) {
    return false;
  }
  const ticketId = url.pathname.slice("/api/media-ticket/".length);
  const ticket = ctx.tickets.lookupActive(ticketId);
  if (ticket === null) {
    sendExpired(res);
    return true;
  }
  const current = ctx.session.current;
  if (current === null || current.absolutePath !== ticket.projectDir) {
    sendExpired(res);
    return true;
  }
  const filePath = await resolveMediaFile(ticket.projectDir, ticket.relativePath);
  if (filePath === null) {
    sendExpired(res);
    return true;
  }
  let size: number;
  try {
    const info = await stat(filePath);
    if (!info.isFile()) {
      sendExpired(res);
      return true;
    }
    size = info.size;
  } catch {
    sendExpired(res);
    return true;
  }
  const range = parseByteRange(headerValue(req.headers.range), size);
  if (range.type === "unsatisfiable") {
    res.writeHead(416, {
      "Content-Range": `bytes */${size}`,
      "Accept-Ranges": "bytes",
      "Cache-Control": "no-store",
    });
    res.end();
    return true;
  }
  const mime = ticket.purpose === "audio" ? await audioMimeFromMagic(filePath) : mimeFor(filePath);
  await pipeFile(req, res, filePath, size, range, mime);
  return true;
}

function purposeAllowed(roles: Set<MediaTicketPurpose>, purpose: MediaTicketPurpose): boolean {
  if (purpose === "original" && roles.has("thumb")) {
    return false;
  }
  return roles.has(purpose);
}

export async function handleIssueMediaTicket(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  body: unknown,
  ctx: { session: ProjectSession; tickets: MediaTicketStore },
): Promise<boolean> {
  const method = (req.method ?? "GET").toUpperCase();
  if (url.pathname !== "/api/projects/current/media-tickets") {
    return false;
  }
  if (method !== "POST") {
    return false;
  }
  if (ctx.session.current === null) {
    sendJson(res, 404, { message: USER_FACING.noProject });
    return true;
  }
  if (!isRecord(body) || typeof body.relativePath !== "string" || !isPurpose(body.purpose)) {
    sendJson(res, 400, { message: BACKEND_MESSAGES.invalidMediaPath });
    return true;
  }
  const relativePath = body.relativePath;
  const purpose = body.purpose;
  if (!isValidProjectRelPath(relativePath) || !isIssuableMediaRelPath(relativePath)) {
    sendJson(res, 400, { message: BACKEND_MESSAGES.invalidMediaPath });
    return true;
  }
  const roles = referencedMediaPurposes(ctx.session.current.project).get(relativePath);
  if (roles === undefined || !purposeAllowed(roles, purpose)) {
    sendJson(res, 403, { message: BACKEND_MESSAGES.forbiddenRequest });
    return true;
  }
  const filePath = await resolveMediaFile(ctx.session.current.absolutePath, relativePath);
  if (filePath === null) {
    sendJson(res, 403, { message: BACKEND_MESSAGES.forbiddenRequest });
    return true;
  }
  const issued = ctx.tickets.issue({
    relativePath,
    purpose,
    projectDir: ctx.session.current.absolutePath,
  });
  sendJson(res, 201, issued);
  return true;
}
