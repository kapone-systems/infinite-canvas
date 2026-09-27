import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { blobRelPath, USER_FACING } from "@canvas/schema";
import { ingestBytes } from "./ingest.ts";
import { absFromRel, sidecarRelPath } from "./layout.ts";
import { encodePngRgba } from "./png.ts";
import { sniffMagic } from "./magic.ts";

async function withTempProject<T>(run: (root: string) => Promise<T>): Promise<T> {
  const root = await mkdtemp(join(tmpdir(), "canvas-ingest-"));
  try {
    return await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function redPng(): Buffer {
  return encodePngRgba(1, 1, new Uint8Array([220, 30, 40, 255]));
}

test("同一字节 SHA-256 稳定，路径是 blobs/<前两位>/<hash>.blob", async () => {
  const png = redPng();
  const expected = createHash("sha256").update(png).digest("hex");
  await withTempProject(async (root) => {
    const first = await ingestBytes({ projectRoot: root, bytes: png, originalFileName: "a.png" });
    assert.equal(first.ok, true);
    if (!first.ok) {
      return;
    }
    assert.equal(first.media.contentHash, expected);
    assert.equal(first.media.relativePath, blobRelPath(expected));
    assert.equal(first.media.relativePath, `media/blobs/${expected.slice(0, 2)}/${expected}.blob`);
    assert.equal(first.media.relativePath.includes("\\"), false);
    const blobAbs = absFromRel(root, first.media.relativePath);
    const onDisk = await readFile(blobAbs);
    assert.deepEqual(Uint8Array.from(onDisk), Uint8Array.from(png));
    const sidecar = JSON.parse(await readFile(absFromRel(root, sidecarRelPath(expected)), "utf8")) as {
      sha256: string;
      source: string;
    };
    assert.equal(sidecar.sha256, expected);
    assert.equal(sidecar.source, "import");
  });
});

test("相同哈希复用，磁盘上只有一份 blob", async () => {
  const png = redPng();
  await withTempProject(async (root) => {
    const first = await ingestBytes({ projectRoot: root, bytes: png, originalFileName: "one.png" });
    const second = await ingestBytes({ projectRoot: root, bytes: png, originalFileName: "two.png" });
    assert.equal(first.ok, true);
    assert.equal(second.ok, true);
    if (!first.ok || !second.ok) {
      return;
    }
    assert.equal(second.reused, true);
    assert.equal(second.media.contentHash, first.media.contentHash);
    assert.equal(second.media.relativePath, first.media.relativePath);
    const blobsRoot = join(root, "media", "blobs");
    const shard = await readdir(blobsRoot);
    assert.equal(shard.length, 1);
    const files = await readdir(join(blobsRoot, shard[0] ?? ""));
    assert.equal(files.filter((name) => name.endsWith(".blob")).length, 1);
  });
});

test("SVG 拒绝，不写 blob，主句是第一版不接收 SVG。", async () => {
  const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"/></svg>`);
  await withTempProject(async (root) => {
    const result = await ingestBytes({ projectRoot: root, bytes: svg, originalFileName: "x.svg" });
    assert.equal(result.ok, false);
    if (result.ok) {
      return;
    }
    assert.equal(result.status, 400);
    assert.equal(result.code, "svg");
    assert.equal(result.message, USER_FACING.ingestSvg);
    assert.equal(result.message, "第一版不接收 SVG。");
    const blobs = join(root, "media", "blobs");
    await assert.rejects(stat(blobs));
  });
});

test("超过上限 413，主句是单个文件超过 2 GiB", async () => {
  const png = redPng();
  await withTempProject(async (root) => {
    const result = await ingestBytes({
      projectRoot: root,
      bytes: png,
      maxBytes: png.byteLength - 1,
    });
    assert.equal(result.ok, false);
    if (result.ok) {
      return;
    }
    assert.equal(result.status, 413);
    assert.equal(result.message, USER_FACING.ingestTooLarge);
  });
});

test("PNG 出 thumb-webp-longedge-512-v1；截断 PNG 原件仍在、thumb 为空", async () => {
  const png = redPng();
  await withTempProject(async (root) => {
    const ok = await ingestBytes({ projectRoot: root, bytes: png });
    assert.equal(ok.ok, true);
    if (!ok.ok) {
      return;
    }
    assert.equal(ok.thumb, "ready");
    assert.equal(typeof ok.media.thumbRelativePath, "string");
    assert.match(ok.media.thumbRelativePath ?? "", /thumb-webp-longedge-512-v1/);
    const thumbAbs = absFromRel(root, ok.media.thumbRelativePath ?? "");
    const thumbBytes = await readFile(thumbAbs);
    assert.equal(sniffMagic(thumbBytes).magic, "webp");
    assert.equal(thumbBytes.includes(Buffer.from("blob:")), false);

    const truncated = png.subarray(0, 24);
    const failed = await ingestBytes({ projectRoot: root, bytes: truncated, originalFileName: "bad.png" });
    assert.equal(failed.ok, true);
    if (!failed.ok) {
      return;
    }
    assert.equal(failed.thumb, "failed");
    assert.equal(failed.media.thumbRelativePath, null);
    const blobStill = await readFile(absFromRel(root, failed.media.relativePath));
    assert.deepEqual(blobStill, Buffer.from(truncated));
  });
});

test("pointermove 路径不哈希", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const repoRoot = join(here, "..", "..", "..", "..");
  const gestures = join(repoRoot, "apps", "web", "src", "canvas", "gestures.ts");
  return readFile(gestures, "utf8").then((text) => {
    assert.equal(text.includes("sha256"), false);
    assert.equal(text.includes("createHash"), false);
    assert.equal(text.includes("media/ingest"), false);
    const move = text.slice(text.indexOf("onPointerMove"), text.indexOf("onPointerUp"));
    assert.equal(move.includes("ingest"), false);
  });
});
