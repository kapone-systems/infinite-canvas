/**
 * 阶段 2 夹具预置小 webp。禁止 ffmpeg / 编码管道。
 * 浏览器 generate.ts 写不了盘；PUT working-copy 合并成功、204 之前 plant。
 */
import { mkdir, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { collectMediaRelPaths, type CanvasProjectFile } from "@canvas/schema";

/** 1×1 合法有损 WebP（硬编码最小字节）。 */
export const FIXTURE_THUMB_WEBP_BASE64 =
  "UklGRiQAAABXRUJQVlA4IBgAAAAwAQCdASoBAAEAAwA0JaQAA3AA/vuUAAA=";

export const FIXTURE_THUMB_SHA256 =
  "bd25bde9fc4427cd6f3babcb8f888fe6174ca48881c103e243d4c6f83f30aab6";

export const THUMB_WEBP_LONGEDGE_512_V1 = "thumb-webp-longedge-512-v1";

export const FIXTURE_THUMB_REL_PATH =
  `media/derived/${FIXTURE_THUMB_SHA256.slice(0, 2)}/${FIXTURE_THUMB_SHA256}/${THUMB_WEBP_LONGEDGE_512_V1}/${FIXTURE_THUMB_SHA256}.webp`;

export const FIXTURE_THUMB_BYTES: Uint8Array = Buffer.from(FIXTURE_THUMB_WEBP_BASE64, "base64");

export function fixtureThumbAbsolutePath(projectRoot: string): string {
  return join(projectRoot, ...FIXTURE_THUMB_REL_PATH.split("/"));
}

export async function plantFixtureThumb(projectRoot: string): Promise<string> {
  const abs = fixtureThumbAbsolutePath(projectRoot);
  await mkdir(dirname(abs), { recursive: true });
  await writeFile(abs, FIXTURE_THUMB_BYTES);
  return abs;
}

async function fileMissing(abs: string): Promise<boolean> {
  try {
    const info = await stat(abs);
    return !info.isFile();
  } catch {
    return true;
  }
}

/**
 * 合并后文档六键引用该已知 derived 且文件缺失则写入。
 */
export async function maybePlantFixtureThumb(
  projectRoot: string,
  project: CanvasProjectFile,
): Promise<boolean> {
  const paths = collectMediaRelPaths(project);
  if (!paths.has(FIXTURE_THUMB_REL_PATH)) {
    return false;
  }
  const abs = fixtureThumbAbsolutePath(projectRoot);
  if (!(await fileMissing(abs))) {
    return false;
  }
  await plantFixtureThumb(projectRoot);
  return true;
}
