/**
 * 方案第 9.3 节媒体路径。工程 JSON 只记正斜杠相对路径。
 */
import { blobRelPath, isValidProjectRelPath } from "@canvas/schema";
import { join } from "node:path";

export { blobRelPath };

/** 方案第 14 节选定上限，不是测出来的容量。 */
export const MAX_INGEST_BYTES = 2 * 1024 * 1024 * 1024;

export const THUMB_WEBP_LONGEDGE_512_V1 = "thumb-webp-longedge-512-v1";

const SHA256_HEX = /^[a-f0-9]{64}$/;
const RECIPE_ID = /^[a-z0-9.-]+$/;
const TASK_ID = /^[A-Za-z0-9._-]+$/;

export function isSha256Hex(value: string): boolean {
  return SHA256_HEX.test(value);
}

export function isRecipeId(value: string): boolean {
  return RECIPE_ID.test(value);
}

export function sidecarRelPath(sha256: string): string {
  if (!isSha256Hex(sha256)) {
    throw new Error("sha256");
  }
  return `media/sidecars/${sha256.slice(0, 2)}/${sha256}.json`;
}

export function derivedRelPath(
  sourceSha256: string,
  recipeId: string,
  derivedSha256: string,
  ext: string,
): string {
  if (!isSha256Hex(sourceSha256) || !isSha256Hex(derivedSha256) || !isRecipeId(recipeId)) {
    throw new Error("derived path");
  }
  if (!/^[a-z0-9]+$/.test(ext)) {
    throw new Error("derived ext");
  }
  return `media/derived/${sourceSha256.slice(0, 2)}/${sourceSha256}/${recipeId}/${derivedSha256}.${ext}`;
}

export function derivedMetaRelPath(
  sourceSha256: string,
  recipeId: string,
  derivedSha256: string,
): string {
  if (!isSha256Hex(sourceSha256) || !isSha256Hex(derivedSha256) || !isRecipeId(recipeId)) {
    throw new Error("derived meta path");
  }
  return `media/derived/${sourceSha256.slice(0, 2)}/${sourceSha256}/${recipeId}/${derivedSha256}.json`;
}

export function incomingPartRelPath(taskId: string): string {
  if (!TASK_ID.test(taskId)) {
    throw new Error("taskId");
  }
  return `media/incoming/${taskId}.part`;
}

export function absFromRel(projectRoot: string, rel: string): string {
  if (!isValidProjectRelPath(rel)) {
    throw new Error("invalid rel");
  }
  return join(projectRoot, ...rel.split("/"));
}
