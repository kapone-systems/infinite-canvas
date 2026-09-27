import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { USER_FACING } from "@canvas/schema";
import { FIXTURE_VIDEO_BYTES } from "../execution/adapters/exampleVideoFixture.ts";
import { ingestBytes } from "./ingest.ts";
import { absFromRel, sidecarRelPath } from "./layout.ts";
import { encodePngRgba } from "./png.ts";

test("导入 ftyp 的 kind 是 video；PNG 仍是 image；SVG 仍拒绝", async () => {
  const root = await mkdtemp(join(tmpdir(), "canvas-video-ingest-"));
  try {
    const video = await ingestBytes({
      projectRoot: root,
      bytes: FIXTURE_VIDEO_BYTES,
      originalFileName: "clip.mp4",
      makeThumb: false,
    });
    assert.equal(video.ok, true);
    if (!video.ok) {
      return;
    }
    assert.equal(video.media.kind, "video");
    assert.notEqual(video.media.kind, "image");
    assert.equal(video.sidecar.kind, "video");
    const blob = await readFile(absFromRel(root, video.media.relativePath));
    assert.equal(blob.byteLength, FIXTURE_VIDEO_BYTES.byteLength);
    const sidecar = JSON.parse(await readFile(absFromRel(root, sidecarRelPath(video.media.contentHash ?? "")), "utf8")) as { kind: string };
    assert.equal(sidecar.kind, "video");

    const png = await ingestBytes({
      projectRoot: root,
      bytes: encodePngRgba(1, 1, new Uint8Array([1, 2, 3, 255])),
      originalFileName: "a.png",
    });
    assert.equal(png.ok, true);
    if (png.ok) {
      assert.equal(png.media.kind, "image");
      assert.equal(png.sidecar.kind, "image");
    }

    const svg = await ingestBytes({
      projectRoot: root,
      bytes: new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'/>"),
      originalFileName: "a.svg",
    });
    assert.equal(svg.ok, false);
    if (!svg.ok) {
      assert.equal(svg.message, "第一版不接收 SVG。");
      assert.equal(svg.message, USER_FACING.ingestSvg);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
