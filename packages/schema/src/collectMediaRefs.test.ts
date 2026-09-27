import assert from "node:assert/strict";
import { test } from "node:test";
import { createEmptyProject } from "./createEmptyProject.ts";
import { collectMediaRelPaths, collectMediaRefs } from "./collectMediaRefs.ts";
import type { MediaRef, ProjectNode } from "./types.ts";

const HASH_A = "ab".repeat(32);
const HASH_B = "cd".repeat(32);

function media(hash: string, path: string): MediaRef {
  return {
    kind: "image",
    relativePath: path,
    contentHash: hash,
    byteSize: 4,
    mimeDetected: "image/png",
    width: 1,
    height: 1,
    durationMs: null,
    firstFrameRelativePath: null,
    lastFrameRelativePath: null,
    coverRelativePath: null,
    proxyRelativePath: null,
    thumbRelativePath: `media/derived/${hash.slice(0, 2)}/${hash}/thumb-webp-longedge-512-v1/${hash}.webp`,
  };
}

function imageNode(id: string, output: MediaRef | null, outputText?: string): ProjectNode {
  return {
    id,
    kind: "image",
    title: id,
    x: 0,
    y: 0,
    width: 280,
    height: 80,
    z: 1,
    groupId: null,
    origin: "detached",
    createdAt: "2026-09-24T00:00:00.000Z",
    updatedAt: "2026-09-24T00:00:00.000Z",
    outputRevision: 1,
    output,
    outputText,
    provenance: { sourceNodeId: "src", versionId: "v", variantId: "var" },
  };
}

test("引用扫描覆盖 output、变体 output 和合法 outputText，反斜杠和 .. 不算", () => {
  const blobA = `media/blobs/ab/${HASH_A}.blob`;
  const blobB = `media/blobs/cd/${HASH_B}.blob`;
  const textPath = `media/blobs/ab/${HASH_A}.blob`;
  const project = createEmptyProject({ projectId: "p", name: "p" });
  const current = media(HASH_A, blobA);
  const older = media(HASH_B, blobB);
  project.nodes.keep = imageNode("keep", current, textPath);
  project.nodes.keep.versions = [
    {
      id: "v1",
      createdAt: "2026-09-24T00:00:00.000Z",
      fingerprint: "fp",
      recipeId: "r",
      recipeVersion: 1,
      paramSnapshot: {},
      variantCountRequested: 1,
      variants: [
        {
          id: "var-old",
          index: 0,
          phase: "succeeded",
          seedUsed: 1,
          output: older,
          text: null,
          error: null,
          createdAt: "2026-09-24T00:00:00.000Z",
        },
      ],
    },
  ];
  project.nodes.words = imageNode("words", null, "这不是路径");
  project.nodes.slash = imageNode("slash", null, "media\\blobs\\nope.blob");
  project.nodes.dot = imageNode("dot", null, "../secret.blob");

  const refs = collectMediaRefs(project);
  assert.equal(refs.length, 2);
  const paths = collectMediaRelPaths(project);
  assert.equal(paths.has(blobA), true);
  assert.equal(paths.has(blobB), true);
  assert.equal(paths.has(current.thumbRelativePath ?? ""), true);
  assert.equal(paths.has("这不是路径"), true);
  assert.equal(paths.has("media\\blobs\\nope.blob"), false);
  assert.equal(paths.has("../secret.blob"), false);
  assert.equal(paths.has(textPath), true);
});
