/**
 * 方案第 9.3 节 thumb-webp-longedge-512-v1。
 * 解码失败：原件不动，thumb 为空，调用方标 partial。不准把原图当画布 img。
 */
import { createHash } from "node:crypto";
import { mkdir, rename, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { existsSync } from "node:fs";
import type { ProjectRelPath } from "@canvas/schema";
import {
  absFromRel,
  derivedMetaRelPath,
  derivedRelPath,
  THUMB_WEBP_LONGEDGE_512_V1,
} from "./layout.ts";
import { sniffMagic } from "./magic.ts";
import { decodePngRgba } from "./png.ts";
import { encodeWebpLossless } from "./webpLossless.ts";
import { isErrno } from "../project/atomicWrite.ts";

export const THUMB_LONG_EDGE = 512;

export type ThumbReady = {
  ok: true;
  recipeId: typeof THUMB_WEBP_LONGEDGE_512_V1;
  relativePath: ProjectRelPath;
  sha256: string;
  byteSize: number;
  width: number;
  height: number;
};

export type ThumbFailed = { ok: false };

function longEdge(width: number, height: number): number {
  return Math.max(width, height);
}

export function scaleRgba(
  width: number,
  height: number,
  rgba: Uint8Array,
  maxEdge: number = THUMB_LONG_EDGE,
): { width: number; height: number; rgba: Uint8Array } {
  const edge = longEdge(width, height);
  if (edge <= maxEdge) {
    return { width, height, rgba: Uint8Array.from(rgba) };
  }
  const scale = maxEdge / edge;
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));
  const out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y += 1) {
    const srcY = Math.min(height - 1, Math.floor((y + 0.5) * height / h));
    for (let x = 0; x < w; x += 1) {
      const srcX = Math.min(width - 1, Math.floor((x + 0.5) * width / w));
      const si = (srcY * width + srcX) * 4;
      const di = (y * w + x) * 4;
      out[di] = rgba[si] ?? 0;
      out[di + 1] = rgba[si + 1] ?? 0;
      out[di + 2] = rgba[si + 2] ?? 0;
      out[di + 3] = rgba[si + 3] ?? 0;
    }
  }
  return { width: w, height: h, rgba: out };
}

async function retryRename(from: string, to: string): Promise<void> {
  let last: unknown;
  for (let i = 0; i < 6; i += 1) {
    try {
      await rename(from, to);
      return;
    } catch (err) {
      last = err;
      if (!isErrno(err, "EBUSY") && !isErrno(err, "EPERM") && !isErrno(err, "EACCES")) {
        throw err;
      }
      await new Promise((resolve) => setTimeout(resolve, 20 * (i + 1)));
    }
  }
  throw last;
}

async function writeDerived(
  projectRoot: string,
  sourceSha256: string,
  webp: Uint8Array,
  width: number,
  height: number,
): Promise<ThumbReady> {
  const sha256 = createHash("sha256").update(webp).digest("hex");
  const relativePath = derivedRelPath(sourceSha256, THUMB_WEBP_LONGEDGE_512_V1, sha256, "webp");
  const abs = absFromRel(projectRoot, relativePath);
  if (!existsSync(abs)) {
    await mkdir(dirname(abs), { recursive: true });
    const tmp = `${abs}.${process.pid}.tmp`;
    await writeFile(tmp, webp);
    try {
      await retryRename(tmp, abs);
    } catch (err) {
      try {
        await unlink(tmp);
      } catch {
        /* keep */
      }
      throw err;
    }
  }
  const metaRel = derivedMetaRelPath(sourceSha256, THUMB_WEBP_LONGEDGE_512_V1, sha256);
  const metaAbs = absFromRel(projectRoot, metaRel);
  if (!existsSync(metaAbs)) {
    await writeFile(
      metaAbs,
      `${JSON.stringify(
        {
          recipeId: THUMB_WEBP_LONGEDGE_512_V1,
          sourceSha256,
          sha256,
          byteSize: webp.byteLength,
          mime: "image/webp",
          width,
          height,
        },
        null,
        2,
      )}\n`,
    );
  }
  return {
    ok: true,
    recipeId: THUMB_WEBP_LONGEDGE_512_V1,
    relativePath,
    sha256,
    byteSize: webp.byteLength,
    width,
    height,
  };
}

function pixelsFromPng(bytes: Uint8Array): { width: number; height: number; rgba: Uint8Array } | null {
  try {
    return decodePngRgba(bytes);
  } catch {
    return null;
  }
}

/**
 * 已是 WebP 且长边不超过 512：不放大，原字节进 derived。
 * PNG：进程内解码再编 VP8L。其余（含 JPEG/GIF 无解码器）失败，不改原件。
 */
export async function deriveThumbWebp(input: {
  projectRoot: string;
  sourceSha256: string;
  bytes: Uint8Array;
}): Promise<ThumbReady | ThumbFailed> {
  const sniff = sniffMagic(input.bytes);
  if (sniff.magic === "webp" && sniff.width !== null && sniff.height !== null) {
    if (longEdge(sniff.width, sniff.height) <= THUMB_LONG_EDGE) {
      try {
        return await writeDerived(input.projectRoot, input.sourceSha256, input.bytes, sniff.width, sniff.height);
      } catch {
        return { ok: false };
      }
    }
    return { ok: false };
  }
  if (sniff.magic !== "png") {
    return { ok: false };
  }
  const decoded = pixelsFromPng(input.bytes);
  if (decoded === null) {
    return { ok: false };
  }
  try {
    const scaled = scaleRgba(decoded.width, decoded.height, decoded.rgba);
    const webp = encodeWebpLossless(scaled.width, scaled.height, scaled.rgba);
    return await writeDerived(input.projectRoot, input.sourceSha256, webp, scaled.width, scaled.height);
  } catch {
    return { ok: false };
  }
}
