import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveSlotMedia } from "./resolveSlotMedia.ts";
import type { MediaRef, ProjectEdge, ProjectNode, Slot } from "./types.ts";

function media(hash: string): MediaRef {
  return {
    kind: "image",
    relativePath: `media/blobs/${hash.slice(0, 2)}/${hash}.blob`,
    contentHash: hash,
    byteSize: 12,
    mimeDetected: "image/png",
    width: 8,
    height: 8,
    durationMs: null,
    firstFrameRelativePath: null,
    lastFrameRelativePath: null,
    coverRelativePath: null,
    proxyRelativePath: null,
    thumbRelativePath: "media/derived/thumb.webp",
  };
}

function imageNode(id: string, output: MediaRef | null, freshness: "fresh" | "stale"): ProjectNode {
  return {
    id,
    kind: "image",
    title: "图",
    x: 0,
    y: 0,
    width: 280,
    height: 80,
    z: 1,
    groupId: null,
    origin: "imported",
    createdAt: "2026-09-24T00:00:00.000Z",
    updatedAt: "2026-09-24T00:00:00.000Z",
    outputRevision: 1,
    output,
    freshness,
  };
}

test("媒体槽读源 output；过期不把图藏起来", () => {
  const hash = "ab".repeat(32);
  const nodes: Record<string, ProjectNode> = {
    img: imageNode("img", media(hash), "stale"),
  };
  const edges: Record<string, ProjectEdge> = {
    e1: {
      id: "e1",
      sourceNodeId: "img",
      targetNodeId: "g",
      targetSlotId: "slot-src",
      role: "source_image",
    },
  };
  const slot: Slot = { id: "slot-src", role: "source_image", order: 1, edgeId: "e1" };
  const resolved = resolveSlotMedia(slot, nodes, edges);
  assert.equal(resolved?.contentHash, hash);
  assert.equal(nodes.img?.freshness, "stale");
});

test("无边则 null", () => {
  const slot: Slot = { id: "slot-src", role: "source_image", order: 1, edgeId: null };
  assert.equal(resolveSlotMedia(slot, {}, {}), null);
});
