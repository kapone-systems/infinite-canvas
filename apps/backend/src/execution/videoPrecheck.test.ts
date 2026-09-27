import assert from "node:assert/strict";
import { test } from "node:test";
import {
  RECIPE_IMG2IMG,
  RECIPE_IMG2VIDEO_FIXTURE,
  RECIPE_IMG2VIDEO_NEEDS_SECRET,
  RECIPE_REFERENCE,
  RECIPE_TXT2IMG,
  USER_FACING,
  type MediaRef,
  type ProjectEdge,
  type ProjectNode,
} from "@canvas/schema";
import { loadRecipeById } from "./recipeLoader.ts";
import { planRun } from "./planRun.ts";

function media(hash = "a".repeat(64)): MediaRef {
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
    thumbRelativePath: null,
  };
}

function node(id: string, extra: Partial<ProjectNode> = {}): ProjectNode {
  return {
    id,
    kind: "generation",
    title: id,
    x: 0,
    y: 0,
    width: 320,
    height: 232,
    z: 1,
    groupId: null,
    origin: "authored",
    createdAt: "2026-09-26T00:00:00.000Z",
    updatedAt: "2026-09-26T00:00:00.000Z",
    outputRevision: 1,
    promptDraft: "一只纸船",
    capabilityId: "video.generate",
    profileId: "img2video",
    recipeId: RECIPE_IMG2VIDEO_FIXTURE,
    recipeVersion: 1,
    outputKind: "video",
    params: { durationSeconds: "4" },
    variantCount: 1,
    slots: [{ id: `${id}-ff`, role: "first_frame", order: 0, edgeId: "e-ff" }],
    phase: "idle",
    freshness: "fresh",
    ...extra,
  };
}

function image(id: string, hash: string): ProjectNode {
  return {
    id,
    kind: "image",
    title: id,
    x: 0,
    y: 0,
    width: 80,
    height: 80,
    z: 0,
    groupId: null,
    origin: "imported",
    createdAt: "2026-09-26T00:00:00.000Z",
    updatedAt: "2026-09-26T00:00:00.000Z",
    outputRevision: 1,
    output: media(hash),
  };
}

const edge: ProjectEdge = {
  id: "e-ff",
  sourceNodeId: "img",
  targetNodeId: "v",
  targetSlotId: "v-ff",
  role: "first_frame",
};

function loadRecipe(id: string) {
  return loadRecipeById(id);
}

test("时长默认字符串 4 通过；3 失败且不入队；没有 cloud 的图片配方不查时长", () => {
  const img = image("img", "a".repeat(64));
  const ok = planRun({
    request: { projectId: "p", scope: { type: "node", nodeId: "v" }, force: false, clientRequestId: "d4" },
    nodes: { img, v: node("v") },
    edges: { "e-ff": edge },
    loadRecipe,
  });
  assert.equal(ok.ok, true);
  if (ok.ok) {
    assert.equal(ok.runnable.length, 1);
    assert.equal(ok.plan.summary.includes(USER_FACING.durationNotAllowed), false);
  }
  const bad = planRun({
    request: { projectId: "p", scope: { type: "node", nodeId: "v" }, force: false, clientRequestId: "d3" },
    nodes: { img, v: node("v", { params: { durationSeconds: "3" } }) },
    edges: { "e-ff": edge },
    loadRecipe,
  });
  assert.equal(bad.ok, false);
  if (!bad.ok) {
    assert.equal(bad.message, "时长（秒）只能是 2、4 或 8。");
    assert.equal(bad.message, USER_FACING.durationNotAllowed);
    assert.equal(bad.plan.nodes.every((row) => row.action === "skip"), true);
  }
  const txt = planRun({
    request: { projectId: "p", scope: { type: "node", nodeId: "g" }, force: false, clientRequestId: "txt" },
    nodes: {
      g: node("g", {
        profileId: "txt2img",
        recipeId: RECIPE_TXT2IMG,
        capabilityId: "image.generate",
        outputKind: "image",
        params: { seed: "random", width: 1024, height: 1024 },
        slots: [{ id: "g-prompt", role: "prompt", order: 0, edgeId: null }],
      }),
    },
    edges: {},
    loadRecipe,
  });
  assert.equal(txt.ok, true);
  const img2 = planRun({
    request: { projectId: "p", scope: { type: "node", nodeId: "g" }, force: false, clientRequestId: "img2" },
    nodes: {
      img,
      g: node("g", {
        profileId: "img2img",
        recipeId: RECIPE_IMG2IMG,
        capabilityId: "image.generate",
        outputKind: "image",
        params: { seed: "random" },
        slots: [
          { id: "g-prompt", role: "prompt", order: 0, edgeId: null },
          { id: "g-src", role: "source_image", order: 1, edgeId: "e-src" },
        ],
      }),
    },
    edges: {
      "e-src": { id: "e-src", sourceNodeId: "img", targetNodeId: "g", targetSlotId: "g-src", role: "source_image" },
    },
    loadRecipe,
  });
  assert.equal(img2.ok, true);
});

test("参考图配方已连参考图不会被「不能用参考图」挡住；遮罩句不变；缺首帧与缺密钥", () => {
  const img = image("img", "b".repeat(64));
  const ref = planRun({
    request: { projectId: "p", scope: { type: "node", nodeId: "r" }, force: false, clientRequestId: "ref" },
    nodes: {
      img,
      r: node("r", {
        profileId: "reference",
        recipeId: RECIPE_REFERENCE,
        capabilityId: "image.generate",
        outputKind: "image",
        params: { seed: "random" },
        slots: [
          { id: "r-prompt", role: "prompt", order: 0, edgeId: null },
          { id: "r-ref", role: "reference_image", order: 1, edgeId: "e-ref" },
        ],
      }),
    },
    edges: {
      "e-ref": { id: "e-ref", sourceNodeId: "img", targetNodeId: "r", targetSlotId: "r-ref", role: "reference_image" },
    },
    loadRecipe,
  });
  assert.equal(ref.ok, true);
  if (ref.ok) {
    assert.equal(ref.plan.summary.includes("这张配方还不能用参考图。"), false);
  }
  const masked = planRun({
    request: { projectId: "p", scope: { type: "node", nodeId: "g" }, force: false, clientRequestId: "mask" },
    nodes: {
      img,
      g: node("g", {
        profileId: "img2img",
        recipeId: RECIPE_IMG2IMG,
        outputKind: "image",
        params: { seed: "random" },
        slots: [
          { id: "g-prompt", role: "prompt", order: 0, edgeId: null },
          { id: "g-src", role: "source_image", order: 1, edgeId: "e-src" },
          { id: "g-mask", role: "mask", order: 2, edgeId: "e-mask" },
        ],
      }),
    },
    edges: {
      "e-src": { id: "e-src", sourceNodeId: "img", targetNodeId: "g", targetSlotId: "g-src", role: "source_image" },
      "e-mask": { id: "e-mask", sourceNodeId: "img", targetNodeId: "g", targetSlotId: "g-mask", role: "mask" },
    },
    loadRecipe,
  });
  assert.equal(masked.ok, false);
  if (!masked.ok) {
    assert.equal(masked.message, "这张配方还不能用遮罩。");
  }
  const missingFrame = planRun({
    request: { projectId: "p", scope: { type: "node", nodeId: "v" }, force: false, clientRequestId: "nof" },
    nodes: { v: node("v", { slots: [{ id: "v-ff", role: "first_frame", order: 0, edgeId: null }] }) },
    edges: {},
    loadRecipe,
  });
  assert.equal(missingFrame.ok, false);
  if (!missingFrame.ok) {
    assert.equal(missingFrame.message, "还缺首帧。");
  }
  let presentCalls = 0;
  const secret = planRun({
    request: { projectId: "p", scope: { type: "node", nodeId: "v" }, force: false, clientRequestId: "sec" },
    nodes: {
      img,
      v: node("v", {
        recipeId: RECIPE_IMG2VIDEO_NEEDS_SECRET,
        secretRef: { providerId: "example.cloud", account: "default" },
      }),
    },
    edges: { "e-ff": edge },
    loadRecipe,
    secretPresent: () => {
      presentCalls += 1;
      return false;
    },
  });
  assert.equal(secret.ok, false);
  if (!secret.ok) {
    assert.equal(secret.message, "还没有配置这一家的密钥。");
  }
  assert.equal(presentCalls, 1);
  presentCalls = 0;
  const fixture = planRun({
    request: { projectId: "p", scope: { type: "node", nodeId: "v" }, force: false, clientRequestId: "fix" },
    nodes: { img, v: node("v") },
    edges: { "e-ff": edge },
    loadRecipe,
    secretPresent: () => {
      presentCalls += 1;
      return false;
    },
  });
  assert.equal(fixture.ok, true);
  assert.equal(presentCalls, 0);
});
