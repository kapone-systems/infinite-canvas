import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFileSync } from "node:fs";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { probeFfmpegFfprobe } from "../ffmpegStatus.ts";
import { audioProbeArgv } from "./audioDuration.ts";
import { ingestBytes } from "./ingest.ts";
import { absFromRel, sidecarRelPath } from "./layout.ts";

function pcmWav(samples: number, sampleRate = 8000): Buffer {
  const dataBytes = samples * 2;
  const buf = Buffer.alloc(44 + dataBytes);
  buf.write("RIFF", 0, "ascii");
  buf.writeUInt32LE(36 + dataBytes, 4);
  buf.write("WAVE", 8, "ascii");
  buf.write("fmt ", 12, "ascii");
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36, "ascii");
  buf.writeUInt32LE(dataBytes, 40);
  return buf;
}

function mp3Bytes(): Buffer {
  return Buffer.from([0x49, 0x44, 0x33, 0x03, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
}

function flacBytes(): Buffer {
  return Buffer.concat([Buffer.from("fLaC", "ascii"), Buffer.alloc(8)]);
}

async function withTemp<T>(run: (root: string) => Promise<T>): Promise<T> {
  const root = await mkdtemp(join(tmpdir(), "canvas-audio-ingest-"));
  try {
    return await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("ffprobe 参数数组，shell false，不含用户原文件名", () => {
  const args = audioProbeArgv("C:/media/blobs/ab/hash.blob");
  assert.deepEqual(args, [
    "-v",
    "error",
    "-print_format",
    "json",
    "-show_format",
    "-show_streams",
    "C:/media/blobs/ab/hash.blob",
  ]);
  assert.equal(args.includes("song.wav"), false);
  const src = readFileSync(new URL("./audioDuration.ts", import.meta.url), "utf8");
  assert.equal(src.includes("shell: false"), true);
  assert.equal(src.includes("shell: true"), false);
  assert.equal(src.includes("deriveVideoWithFfmpeg("), false);
});

test("wav/mp3/flac 入库 kind 为 audio，没有代理和封面；没有 ffprobe 也不拒绝", async () => {
  await withTemp(async (root) => {
    const missing = join(root, "no-ffprobe.exe");
    const samples = [
      { name: "a.wav", bytes: pcmWav(16), mime: "audio/wav", magic: "wav" },
      { name: "b.mp3", bytes: mp3Bytes(), mime: "audio/mpeg", magic: "mp3" },
      { name: "c.flac", bytes: flacBytes(), mime: "audio/flac", magic: "flac" },
    ];
    for (const sample of samples) {
      const result = await ingestBytes({
        projectRoot: root,
        bytes: sample.bytes,
        originalFileName: sample.name,
        ffprobePath: missing,
        ffmpegMaxRunMs: 5000,
      });
      assert.equal(result.ok, true, sample.name);
      if (!result.ok) {
        return;
      }
      assert.equal(result.media.kind, "audio");
      assert.equal(result.media.mimeDetected, sample.mime);
      assert.equal(result.media.durationMs, null);
      assert.equal(result.media.proxyRelativePath, null);
      assert.equal(result.media.coverRelativePath, null);
      assert.equal(result.media.firstFrameRelativePath, null);
      assert.equal(result.media.lastFrameRelativePath, null);
      assert.equal(result.media.thumbRelativePath, null);
      assert.equal(result.sidecar.kind, "audio");
      assert.equal(result.sidecar.sniff.magic, sample.magic);
      assert.equal(existsSync(absFromRel(root, result.media.relativePath)), true);
    }
    assert.equal(existsSync(join(root, "media", "derived")), false);
  });
});

test("相同 wav 重复导入只留一份 blob", async () => {
  const wav = pcmWav(32);
  await withTemp(async (root) => {
    const missing = join(root, "no-ffprobe.exe");
    const first = await ingestBytes({
      projectRoot: root,
      bytes: wav,
      originalFileName: "one.wav",
      ffprobePath: missing,
    });
    const second = await ingestBytes({
      projectRoot: root,
      bytes: wav,
      originalFileName: "two.wav",
      ffprobePath: missing,
    });
    assert.equal(first.ok, true);
    assert.equal(second.ok, true);
    if (!first.ok || !second.ok) {
      return;
    }
    assert.equal(second.reused, true);
    assert.equal(second.media.contentHash, first.media.contentHash);
    assert.equal(second.media.relativePath, first.media.relativePath);
    assert.equal(second.media.kind, "audio");
    const blobsRoot = join(root, "media", "blobs");
    const shard = await readdir(blobsRoot);
    assert.equal(shard.length, 1);
    const files = await readdir(join(blobsRoot, shard[0] ?? ""));
    assert.equal(files.filter((name) => name.endsWith(".blob")).length, 1);
    const sidecar = JSON.parse(
      await readFile(absFromRel(root, sidecarRelPath(first.media.contentHash ?? "")), "utf8"),
    ) as { kind: string; durationRaw: string | null };
    assert.equal(sidecar.kind, "audio");
    assert.equal(sidecar.durationRaw, null);
  });
});

test("ffprobe 读到 wav 时长就写毫秒；读不到仍成功且不是 0", async () => {
  const wav = pcmWav(8000, 8000);
  await withTemp(async (root) => {
    const probed = await probeFfmpegFfprobe({ timeoutMs: 5000 });
    const result = await ingestBytes({
      projectRoot: root,
      bytes: wav,
      originalFileName: "one-second.wav",
      ffmpegMaxRunMs: 15000,
    });
    assert.equal(result.ok, true);
    if (!result.ok) {
      return;
    }
    assert.equal(result.media.kind, "audio");
    assert.equal(result.media.proxyRelativePath, null);
    assert.equal(result.media.coverRelativePath, null);
    assert.notEqual(result.media.durationMs, 0);
    if (probed.ffprobe !== "ok") {
      assert.equal(result.media.durationMs, null);
      return;
    }
    assert.equal(typeof result.media.durationMs, "number");
    assert.ok((result.media.durationMs ?? 0) >= 900);
    assert.ok((result.media.durationMs ?? 0) <= 1100);
    const sidecar = JSON.parse(
      await readFile(absFromRel(root, sidecarRelPath(result.media.contentHash ?? "")), "utf8"),
    ) as { durationRaw: string | null };
    assert.equal(typeof sidecar.durationRaw, "string");
  });
});
