import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { blobRelPath, videoDerivativesReady, type MediaRef } from "@canvas/schema";
import { FIXTURE_VIDEO_BYTES } from "../execution/adapters/exampleVideoFixture.ts";
import { probeFfmpegFfprobe } from "../ffmpegStatus.ts";
import { absFromRel } from "./layout.ts";
import { sniffMagic } from "./magic.ts";
import { deriveVideoWithFfmpeg, FFMPEG_MAX_RUN_MS, videoDeriveArgv } from "./videoDerive.ts";

test("夹具字节含 moov，单条 ffmpeg 默认 30 分钟", () => {
  assert.ok(FIXTURE_VIDEO_BYTES.byteLength > 32);
  assert.equal(sniffMagic(FIXTURE_VIDEO_BYTES).magic, "mp4");
  assert.ok(Buffer.from(FIXTURE_VIDEO_BYTES).includes(Buffer.from("moov")));
  assert.equal(FFMPEG_MAX_RUN_MS, 30 * 60 * 1000);
  const src = readFileSync(new URL("./videoDerive.ts", import.meta.url), "utf8");
  assert.equal(src.includes("20000"), false);
  const commands = videoDeriveArgv("in.mp4", {
    first: "a.png",
    last: "b.png",
    cover: "c.webp",
    proxy: "d.mp4",
  });
  const last = commands.find((item) => item.args.includes("b.png"));
  assert.ok(last !== undefined);
  assert.equal(last?.args.includes("-1"), true);
  assert.equal(last?.args.includes("-0.1"), false);
  const cover = commands.find((item) => item.args.includes("c.webp"));
  assert.equal(cover?.args.some((arg) => arg.includes("min(1280,iw)")), true);
});

test("ffmpeg 可用时夹具抽出时长和四件派生；缺失时失败且不抛", async () => {
  const root = await mkdtemp(join(tmpdir(), "canvas-derive-"));
  try {
    const sha = createHash("sha256").update(FIXTURE_VIDEO_BYTES).digest("hex");
    const relativePath = blobRelPath(sha);
    const abs = absFromRel(root, relativePath);
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, FIXTURE_VIDEO_BYTES);
    const media: MediaRef = {
      kind: "video",
      relativePath,
      contentHash: sha,
      byteSize: FIXTURE_VIDEO_BYTES.byteLength,
      mimeDetected: "video/mp4",
      width: null,
      height: null,
      durationMs: null,
      firstFrameRelativePath: null,
      lastFrameRelativePath: null,
      coverRelativePath: null,
      proxyRelativePath: null,
      thumbRelativePath: null,
    };
    const probed = await probeFfmpegFfprobe({ timeoutMs: 5000 });
    const derived = await deriveVideoWithFfmpeg({ projectRoot: root, media });
    if (probed.ffmpeg !== "ok" || probed.ffprobe !== "ok") {
      assert.equal(derived.ok, false);
      return;
    }
    assert.equal(derived.ok, true);
    if (!derived.ok) {
      return;
    }
    assert.equal(videoDerivativesReady(derived.media), true);
    assert.ok((derived.media.durationMs ?? 0) > 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
