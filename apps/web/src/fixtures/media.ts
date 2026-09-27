/**
 * 阶段 2 夹具预置小 webp：工程 JSON 只记正斜杠相对路径和 contentHash。
 * 近景预览走 derived thumb，不要把 blob 原件当 img.src，不要 data URL。
 */
import type { MediaRef } from "@canvas/schema";
import { blobRelPath, isValidProjectRelPath } from "@canvas/schema";

/** 1×1 合法有损 WebP（硬编码最小字节）。 */
export const FIXTURE_WEBP_BASE64 =
  "UklGRiQAAABXRUJQVlA4IBgAAAAwAQCdASoBAAEAAwA0JaQAA3AA/vuUAAA=";

export const THUMB_WEBP_LONGEDGE_512_V1 = "thumb-webp-longedge-512-v1";

/** SHA-256（小写 64 位），与 FIXTURE_WEBP_BYTES 对应；单测用 node:crypto 复核。 */
export const FIXTURE_WEBP_SHA256 =
  "bd25bde9fc4427cd6f3babcb8f888fe6174ca48881c103e243d4c6f83f30aab6";

function decodeBase64(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export const FIXTURE_WEBP_BYTES: Uint8Array = decodeBase64(FIXTURE_WEBP_BASE64);

export function fixtureBlobRelPath(): string {
  return blobRelPath(FIXTURE_WEBP_SHA256);
}

/** 方案第 8 / 9.3 节 derived/<前两位>/<源 hash>/<recipeId>/<派生 hash>.<ext> */
export function derivedRelPath(
  sourceSha256: string,
  recipeId: string,
  derivedSha256: string,
  ext: string,
): string {
  return `media/derived/${sourceSha256.slice(0, 2)}/${sourceSha256}/${recipeId}/${derivedSha256}.${ext}`;
}

export function fixtureThumbRelPath(): string {
  return derivedRelPath(
    FIXTURE_WEBP_SHA256,
    THUMB_WEBP_LONGEDGE_512_V1,
    FIXTURE_WEBP_SHA256,
    "webp",
  );
}

/** 一百夹具里额外的一张刚生成缩略图，不替换预置夹具图。 */
export const FRESH_GENERATED_SHA256 = "cd".repeat(32);

export function freshGeneratedThumbRelPath(): string {
  return derivedRelPath(
    FRESH_GENERATED_SHA256,
    THUMB_WEBP_LONGEDGE_512_V1,
    FRESH_GENERATED_SHA256,
    "webp",
  );
}

export function freshGeneratedMediaRef(): MediaRef {
  return {
    kind: "image",
    relativePath: blobRelPath(FRESH_GENERATED_SHA256),
    contentHash: FRESH_GENERATED_SHA256,
    byteSize: FIXTURE_WEBP_BYTES.byteLength,
    mimeDetected: "image/webp",
    width: 1,
    height: 1,
    durationMs: null,
    firstFrameRelativePath: null,
    lastFrameRelativePath: null,
    coverRelativePath: null,
    proxyRelativePath: null,
    thumbRelativePath: freshGeneratedThumbRelPath(),
  };
}

export type FixtureMediaFile = {
  relativePath: string;
  bytes: Uint8Array;
};

/** 原件 blob + 同字节 thumb（已是 1×1，不放大）。相对路径一律正斜杠。 */
export function fixtureMediaFiles(): readonly FixtureMediaFile[] {
  const blob = fixtureBlobRelPath();
  const thumb = fixtureThumbRelPath();
  if (!isValidProjectRelPath(blob) || !isValidProjectRelPath(thumb)) {
    throw new Error("fixture media relative path is invalid");
  }
  return [
    { relativePath: blob, bytes: FIXTURE_WEBP_BYTES },
    { relativePath: thumb, bytes: FIXTURE_WEBP_BYTES },
  ];
}

/** 画布近景只用 thumbRelativePath；relativePath 是原件，不得当预览。 */
export function fixtureImageMediaRef(): MediaRef {
  return {
    kind: "image",
    relativePath: fixtureBlobRelPath(),
    contentHash: FIXTURE_WEBP_SHA256,
    byteSize: FIXTURE_WEBP_BYTES.byteLength,
    mimeDetected: "image/webp",
    width: 1,
    height: 1,
    durationMs: null,
    firstFrameRelativePath: null,
    lastFrameRelativePath: null,
    coverRelativePath: null,
    proxyRelativePath: null,
    thumbRelativePath: fixtureThumbRelPath(),
  };
}
