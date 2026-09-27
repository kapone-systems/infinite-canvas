/**
 * 打开工程时把无人引用的媒体隔离到 media/trash。
 * 会话内不调用。隔离满 7 天才在成功的这一轮里物理删除。
 * 清空回收站另走 emptyTrash，不看天数。不清 incoming。
 * 保留集来自正式文件、autosave 和 bak。任一存在但解析或校验失败则整次取消。
 * 删节点并保存一次后再打开，上一份 bak 仍引用的文件留在 blobs。
 * 再保存一次盖掉这份 bak 之后，下次打开才隔离。
 */
import { mkdir, readdir, rename, rm, stat, unlink, utimes } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import type { CanvasProjectFile } from "@canvas/schema";
import { collectMediaRefs, collectMediaRelPaths } from "@canvas/schema";
import { isErrno, projectAutosavePath, projectBakPath, projectFilePath } from "../project/atomicWrite.ts";
import { readCanvasFile } from "../project/readCanvasFile.ts";
import { absFromRel } from "./layout.ts";

const SHA256_HEX = /^[a-f0-9]{64}$/;
const BLOB_PATH = /^media\/blobs\/[a-f0-9]{2}\/([a-f0-9]{64})\.blob$/;
const SIDECAR_PATH = /^media\/sidecars\/[a-f0-9]{2}\/([a-f0-9]{64})\.json$/;
const DERIVED_PATH = /^media\/derived\/[a-f0-9]{2}\/([a-f0-9]{64})\//;

const ROOTS = ["media/blobs", "media/derived", "media/sidecars"] as const;
const TRASH_KEEP_MS = 7 * 24 * 60 * 60 * 1000;

export type RecycleResult =
  | { ok: true; moved: string[] }
  | { ok: false; reason: "cancelled" };

function delay(ms: number): Promise<void> {
  return new Promise((resolveDelay) => {
    setTimeout(resolveDelay, ms);
  });
}

function fsPath(abs: string): string {
  const full = resolve(abs);
  if (process.platform !== "win32" || full.length < 240 || full.startsWith("\\\\?\\")) {
    return full;
  }
  return `\\\\?\\${full}`;
}

function hashInPath(rel: string): string | null {
  const blob = BLOB_PATH.exec(rel);
  if (blob?.[1] !== undefined) {
    return blob[1];
  }
  const sidecar = SIDECAR_PATH.exec(rel);
  if (sidecar?.[1] !== undefined) {
    return sidecar[1];
  }
  const derived = DERIVED_PATH.exec(rel);
  if (derived?.[1] !== undefined) {
    return derived[1];
  }
  return null;
}

function absorb(project: CanvasProjectFile, paths: Set<string>, hashes: Set<string>): void {
  for (const rel of collectMediaRelPaths(project)) {
    paths.add(rel);
    const fromPath = hashInPath(rel);
    if (fromPath !== null) {
      hashes.add(fromPath);
    }
  }
  for (const ref of collectMediaRefs(project)) {
    if (typeof ref.contentHash === "string" && SHA256_HEX.test(ref.contentHash)) {
      hashes.add(ref.contentHash);
    }
  }
}

async function walkFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (err) {
    if (isErrno(err, "ENOENT")) {
      return out;
    }
    throw err;
  }
  for (const entry of entries) {
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await walkFiles(abs)));
    } else if (entry.isFile()) {
      out.push(abs);
    }
  }
  return out;
}

function toRel(projectDir: string, abs: string): string {
  return relative(projectDir, abs).split(sep).join("/");
}

async function moveToTrash(projectDir: string, rel: string): Promise<boolean> {
  const destRel = `media/trash/${rel.slice("media/".length)}`;
  const from = fsPath(absFromRel(projectDir, rel));
  const to = fsPath(absFromRel(projectDir, destRel));
  await mkdir(dirname(to), { recursive: true });
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await rename(from, to);
      await utimes(to, new Date(), new Date());
      return true;
    } catch (err) {
      if (isErrno(err, "EEXIST")) {
        try {
          await unlink(from);
          return true;
        } catch {
          return false;
        }
      }
      if (isErrno(err, "EBUSY") || isErrno(err, "EPERM") || isErrno(err, "EACCES")) {
        await delay(20 * (attempt + 1));
        continue;
      }
      return false;
    }
  }
  return false;
}

/**
 * 正式文件、autosave、bak：不存在就跳过。
 * 存在但解析失败或校验失败则整次不移不删。
 * 保留集并入这三份里校验通过的引用。
 */
export async function recycleUnreferencedMedia(projectDir: string): Promise<RecycleResult> {
  const official = await readCanvasFile(projectFilePath(projectDir));
  const autosave = await readCanvasFile(projectAutosavePath(projectDir));
  const bak = await readCanvasFile(projectBakPath(projectDir));
  for (const read of [official, autosave, bak]) {
    if (read.state !== "missing" && read.state !== "ok") {
      return { ok: false, reason: "cancelled" };
    }
  }
  const projects: CanvasProjectFile[] = [];
  if (official.state === "ok") {
    projects.push(official.project);
  }
  if (autosave.state === "ok") {
    projects.push(autosave.project);
  }
  if (bak.state === "ok") {
    projects.push(bak.project);
  }
  const keepPaths = new Set<string>();
  const keepHashes = new Set<string>();
  for (const project of projects) {
    absorb(project, keepPaths, keepHashes);
  }
  const moved: string[] = [];
  for (const root of ROOTS) {
    const absRoot = join(projectDir, ...root.split("/"));
    const files = await walkFiles(absRoot);
    for (const abs of files) {
      const rel = toRel(projectDir, abs);
      if (!rel.startsWith("media/") || rel.startsWith("media/trash/") || rel.startsWith("media/incoming/")) {
        continue;
      }
      const owned = hashInPath(rel);
      if (keepPaths.has(rel) || (owned !== null && keepHashes.has(owned))) {
        continue;
      }
      const did = await moveToTrash(projectDir, rel);
      if (did) {
        moved.push(rel);
      }
    }
  }
  await purgeExpiredTrash(projectDir, Date.now());
  return { ok: true, moved };
}

async function purgeExpiredTrash(projectDir: string, nowMs: number): Promise<void> {
  const trashRoot = join(projectDir, "media", "trash");
  const files = await walkFiles(trashRoot);
  for (const abs of files) {
    let mtimeMs = nowMs;
    try {
      mtimeMs = (await stat(abs)).mtimeMs;
    } catch {
      continue;
    }
    if (nowMs - mtimeMs < TRASH_KEEP_MS) {
      continue;
    }
    try {
      await unlink(fsPath(abs));
    } catch {
      /* 删不掉就留在 trash，不把打开打成失败 */
    }
  }
}

export async function listMissingBlobPaths(
  projectDir: string,
  project: CanvasProjectFile,
): Promise<string[]> {
  const missing: string[] = [];
  for (const rel of collectMediaRelPaths(project)) {
    if (!rel.startsWith("media/blobs/")) {
      continue;
    }
    try {
      const info = await stat(absFromRel(projectDir, rel));
      if (!info.isFile()) {
        missing.push(rel);
      }
    } catch {
      missing.push(rel);
    }
  }
  missing.sort();
  return missing;
}

/** 只删 media/trash。不动 blobs、derived、sidecars、incoming。 */
export async function emptyTrash(projectDir: string): Promise<void> {
  const trash = absFromRel(projectDir, "media/trash");
  await rm(trash, { recursive: true, force: true });
}
