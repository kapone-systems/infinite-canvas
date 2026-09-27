import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  evaluateConnect,
  MEDIA_KIND_LABELS,
  USER_FACING,
  videoPreviewPending,
  type ProjectNode,
} from "@canvas/schema";
import { generationPreviewMain } from "./document.ts";
import { paintPlayTriangle, shouldPaintPlayTriangle } from "./EdgeCanvas.ts";
import { claimPlayback, resetPlaybackForTests } from "./playback.ts";
import { COPY } from "../ui/copy.ts";

const here = dirname(fileURLToPath(import.meta.url));

function bare(partial: Partial<ProjectNode>): ProjectNode {
  return {
    id: "n",
    kind: "generation",
    title: "n",
    x: 0,
    y: 0,
    width: 10,
    height: 10,
    z: 1,
    groupId: null,
    origin: "authored",
    createdAt: "2026-09-26T00:00:00.000Z",
    updatedAt: "2026-09-26T00:00:00.000Z",
    outputRevision: 1,
    ...partial,
  };
}

test("远景三角只给视频素材和 outputKind 为 video 的生成节点", () => {
  assert.equal(shouldPaintPlayTriangle(bare({ kind: "video", outputKind: undefined })), true);
  assert.equal(shouldPaintPlayTriangle(bare({ kind: "generation", outputKind: "video" })), true);
  assert.equal(shouldPaintPlayTriangle(bare({ kind: "generation", outputKind: "image" })), false);
  const calls: string[] = [];
  paintPlayTriangle(
    {
      fillStyle: "",
      beginPath: () => {
        calls.push("begin");
      },
      moveTo: () => {
        calls.push("move");
      },
      lineTo: () => {
        calls.push("line");
      },
      closePath: () => {
        calls.push("close");
      },
      fill: () => {
        calls.push("fill");
      },
    },
    0,
    0,
    40,
    40,
  );
  assert.equal(calls.includes("begin"), true);
  assert.equal(calls.filter((item) => item === "line").length, 2);
  assert.equal(calls.includes("fill"), true);
  const src = readFileSync(join(here, "EdgeCanvas.ts"), "utf8");
  assert.equal(src.includes("shouldPaintPlayTriangle(node)"), true);
  assert.equal(src.includes("<video"), false);
});

test("预览未齐主句是正在准备预览；图片无缩略图不改成这句", () => {
  const pending = bare({
    outputKind: "video",
    output: {
      kind: "video",
      relativePath: "media/blobs/aa/" + "a".repeat(64) + ".blob",
      contentHash: "a".repeat(64),
      byteSize: 4,
      mimeDetected: "video/mp4",
      width: null,
      height: null,
      durationMs: null,
      firstFrameRelativePath: null,
      lastFrameRelativePath: null,
      coverRelativePath: null,
      proxyRelativePath: null,
      thumbRelativePath: null,
    },
  });
  assert.equal(videoPreviewPending(pending), true);
  assert.equal(generationPreviewMain(pending), "正在准备预览");
  const image = bare({
    outputKind: "image",
    output: {
      kind: "image",
      relativePath: "media/blobs/bb/" + "b".repeat(64) + ".blob",
      contentHash: "b".repeat(64),
      byteSize: 4,
      mimeDetected: "image/png",
      width: 8,
      height: 8,
      durationMs: null,
      firstFrameRelativePath: null,
      lastFrameRelativePath: null,
      coverRelativePath: null,
      proxyRelativePath: null,
      thumbRelativePath: null,
    },
  });
  assert.equal(generationPreviewMain(image), null);
  const gen = readFileSync(join(here, "GenerationNode.tsx"), "utf8");
  const video = readFileSync(join(here, "VideoNode.tsx"), "utf8");
  assert.equal(gen.includes("<video"), false);
  assert.equal(video.includes("<video"), false);
  assert.equal(gen.includes('data-playback="poster"') || video.includes('data-playback="poster"'), true);
  assert.equal(video.includes('purpose="cover"'), true);
  assert.equal(video.includes('purpose="thumb"'), true);
  assert.equal(video.includes("disabled={!ready}"), true);
  const viewer = readFileSync(join(here, "VideoViewer.tsx"), "utf8");
  assert.equal(viewer.includes("<video"), true);
  assert.equal(viewer.includes('purpose: "proxy"'), true);
  assert.equal(viewer.includes("createObjectURL"), false);
  const inspector = readFileSync(join(here, "..", "ui", "Inspector.tsx"), "utf8");
  assert.equal(COPY.lastFrameApproximate, USER_FACING.lastFrameApproximate);
  assert.equal(COPY.lastFrameApproximate, "尾帧是近似的，本机还没有核实。");
  assert.equal(inspector.includes("COPY.lastFrameApproximate"), true);
  assert.equal(inspector.includes("data-recipe-id"), true);
  assert.equal(inspector.includes("data-regenerate-preview"), true);
  assert.equal(inspector.includes("adapterId"), false);
  assert.equal(video.includes('label="首帧图"'), true);
  assert.equal(video.includes('label="尾帧图"'), true);
  assert.equal(inspector.includes('label="首帧图"'), true);
  assert.equal(inspector.includes('label="尾帧图"'), true);
  assert.equal(video.includes('label="首帧"'), false);
  assert.equal(inspector.includes('label="首帧"'), false);
});

test("查看器同一时间只认一个播放；提示词不能进首帧槽", () => {
  resetPlaybackForTests();
  const paused: string[] = [];
  claimPlayback("a", () => paused.push("a"));
  claimPlayback("b", () => paused.push("b"));
  assert.deepEqual(paused, ["a"]);
  const text = bare({ id: "t", kind: "text" });
  const target = bare({
    id: "v",
    outputKind: "video",
    slots: [{ id: "ff", role: "first_frame", order: 0, edgeId: null }],
  });
  const result = evaluateConnect({
    sourceNodeId: "t",
    nodes: { t: text, v: target },
    edges: {},
    target: { type: "slot", nodeId: "v", slotId: "ff" },
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.message, `不能把「${MEDIA_KIND_LABELS.text}」接到「首帧」槽`);
  }
});
