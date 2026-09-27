import assert from "node:assert/strict";
import { test } from "node:test";
import {
  RECIPE_IMG2IMG,
  RECIPE_REFERENCE,
  RECIPE_TXT2IMG,
  USER_FACING,
  fingerprintNode,
  type MediaRef,
  type ProjectEdge,
  type ProjectNode,
} from "@canvas/schema";
import { loadRecipeById } from "./recipeLoader.ts";
import { allocateSeeds, planRun } from "./planRun.ts";

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
    thumbRelativePath: `media/derived/${hash.slice(0, 2)}/${hash}/thumb-webp-longedge-512-v1/${hash}.webp`,
  };
}

function baseNode(id: string, extra: Partial<ProjectNode> = {}): ProjectNode {
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
    createdAt: "2026-09-25T00:00:00.000Z",
    updatedAt: "2026-09-25T00:00:00.000Z",
    outputRevision: 1,
    promptDraft: extra.promptDraft ?? "一只纸船",
    capabilityId: "image.generate",
    profileId: "txt2img",
    recipeId: RECIPE_TXT2IMG,
    recipeVersion: 1,
    outputKind: "image",
    params: { seed: "random", width: 1024, height: 1024 },
    variantCount: 1,
    slots: [{ id: `${id}-prompt`, role: "prompt", order: 0, edgeId: null }],
    phase: "idle",
    freshness: "fresh",
    ...extra,
  };
}

function textNode(id: string, text: string): ProjectNode {
  return {
    id,
    kind: "text",
    title: id,
    x: 0,
    y: 0,
    width: 280,
    height: 180,
    z: 0,
    groupId: null,
    origin: "authored",
    createdAt: "2026-09-25T00:00:00.000Z",
    updatedAt: "2026-09-25T00:00:00.000Z",
    outputRevision: 1,
    text,
  };
}

function imageNode(id: string, output: MediaRef): ProjectNode {
  return {
    id,
    kind: "image",
    title: id,
    x: 0,
    y: 0,
    width: 280,
    height: 80,
    z: 0,
    groupId: null,
    origin: "imported",
    createdAt: "2026-09-25T00:00:00.000Z",
    updatedAt: "2026-09-25T00:00:00.000Z",
    outputRevision: 1,
    output,
  };
}

function edge(
  id: string,
  sourceNodeId: string,
  targetNodeId: string,
  targetSlotId: string,
  role: ProjectEdge["role"],
): ProjectEdge {
  return { id, sourceNodeId, targetNodeId, targetSlotId, role };
}

function loadRecipe(id: string) {
  return loadRecipeById(id);
}

function withSuccess(node: ProjectNode, nodes: Record<string, ProjectNode>, edges: Record<string, ProjectEdge>): ProjectNode {
  const fp = fingerprintNode(node, nodes, edges);
  const output = media("b".repeat(64));
  const next: ProjectNode = {
    ...node,
    phase: "succeeded",
    freshness: "fresh",
    lastSuccessFingerprint: fp,
    lastAttemptFingerprint: fp,
    output,
    currentVersionId: "v1",
    activeVariantId: "va",
    versions: [
      {
        id: "v1",
        createdAt: "2026-09-25T00:00:00.000Z",
        fingerprint: fp,
        recipeId: node.recipeId ?? RECIPE_TXT2IMG,
        recipeVersion: 1,
        paramSnapshot: { ...(node.params ?? {}) },
        variantCountRequested: node.variantCount ?? 1,
        variants: [
          {
            id: "va",
            index: 0,
            phase: "succeeded",
            seedUsed: 1,
            output,
            text: null,
            error: null,
            createdAt: "2026-09-25T00:00:00.000Z",
          },
        ],
      },
    ],
  };
  nodes[node.id] = next;
  const fp2 = fingerprintNode(next, nodes, edges);
  next.lastSuccessFingerprint = fp2;
  next.versions![0]!.fingerprint = fp2;
  return next;
}

test("allocateSeeds：用户数字 n 则 n,n+1…；random 各抽", () => {
  assert.deepEqual(allocateSeeds({ seed: 7 }, 4, () => 1), [7, 8, 9, 10]);
  assert.deepEqual(allocateSeeds({ seed: "7" }, 4, () => 1), [7, 8, 9, 10]);
  const randoms = allocateSeeds({ seed: "random" }, 3, (() => {
    let n = 10;
    return () => {
      n += 1;
      return n;
    };
  })());
  assert.deepEqual(randoms, [11, 12, 13]);
});

test("新鲜跳过 runSkippedFresh；部分成功徽章 succeeded 仍 skip 不是 run", () => {
  const t = textNode("t", "一只纸船");
  const g1 = baseNode("g1", {
    variantCount: 4,
    slots: [{ id: "g1-prompt", role: "prompt", order: 0, edgeId: "e-t" }],
  });
  const nodes: Record<string, ProjectNode> = { t, g1 };
  const edges: Record<string, ProjectEdge> = {
    "e-t": edge("e-t", "t", "g1", "g1-prompt", "prompt"),
  };
  withSuccess(g1, nodes, edges);
  const version = nodes.g1!.versions![0]!;
  version.variantCountRequested = 4;
  version.variants.push({
    id: "vf",
    index: 1,
    phase: "failed",
    seedUsed: null,
    output: null,
    text: null,
    error: { code: "X", message: USER_FACING.generationIncomplete },
    createdAt: "2026-09-25T00:00:00.000Z",
  });
  const fp = fingerprintNode(nodes.g1!, nodes, edges);
  nodes.g1!.lastSuccessFingerprint = fp;
  nodes.g1!.lastAttemptFingerprint = fp;
  nodes.g1!.phase = "succeeded";
  const down = planRun({
    request: {
      projectId: "p",
      scope: { type: "downstream", nodeId: "t" },
      force: true,
      clientRequestId: "c",
    },
    nodes,
    edges,
    loadRecipe,
  });
  assert.equal(down.ok, true);
  const row = down.plan.nodes.find((item) => item.nodeId === "g1");
  assert.equal(row?.action, "skip");
  assert.equal(row?.skipReason, "fresh");
  assert.equal(row?.message, USER_FACING.runSkippedFresh);
  assert.equal(down.runnable.some((item) => item.nodeId === "g1"), false);
});

test("此节点只含自己；下游不含起点；选区不拉外面", () => {
  const img = imageNode("img", media());
  const g1 = baseNode("g1", {
    profileId: "img2img",
    recipeId: RECIPE_IMG2IMG,
    slots: [
      { id: "g1-prompt", role: "prompt", order: 0, edgeId: null },
      { id: "g1-src", role: "source_image", order: 1, edgeId: "e-src" },
    ],
  });
  const g2 = baseNode("g2", {
    profileId: "img2img",
    recipeId: RECIPE_IMG2IMG,
    x: 400,
    slots: [
      { id: "g2-prompt", role: "prompt", order: 0, edgeId: null },
      { id: "g2-src", role: "source_image", order: 1, edgeId: "e-src2" },
    ],
  });
  const gOutside = baseNode("gout", {
    profileId: "img2img",
    recipeId: RECIPE_IMG2IMG,
    x: 800,
    slots: [
      { id: "gout-prompt", role: "prompt", order: 0, edgeId: null },
      { id: "gout-src", role: "source_image", order: 1, edgeId: "e-src3" },
    ],
  });
  const nodes: Record<string, ProjectNode> = { img, g1, g2, gout: gOutside };
  const edges: Record<string, ProjectEdge> = {
    "e-src": edge("e-src", "img", "g1", "g1-src", "source_image"),
    "e-src2": edge("e-src2", "g1", "g2", "g2-src", "source_image"),
    "e-src3": edge("e-src3", "g1", "gout", "gout-src", "source_image"),
  };
  withSuccess(g1, nodes, edges);
  nodes.g1!.output = media("c".repeat(64));
  nodes.g1!.freshness = "stale";
  nodes.g1!.lastSuccessFingerprint = "old";

  const onlySelf = planRun({
    request: {
      projectId: "p",
      scope: { type: "node", nodeId: "g2" },
      force: false,
      clientRequestId: "n",
    },
    nodes,
    edges,
    loadRecipe,
  });
  assert.equal(onlySelf.ok, true);
  assert.deepEqual(onlySelf.plan.nodes.map((row) => row.nodeId), ["g2"]);
  assert.equal(onlySelf.runnable.length, 1);
  assert.equal(onlySelf.runnable[0]?.nodeId, "g2");

  const down = planRun({
    request: {
      projectId: "p",
      scope: { type: "downstream", nodeId: "g1" },
      force: true,
      clientRequestId: "d",
    },
    nodes,
    edges,
    loadRecipe,
  });
  assert.equal(down.ok, true);
  assert.equal(down.plan.nodes.some((row) => row.nodeId === "g1" && row.action === "skip"), true);
  assert.equal(
    down.plan.nodes.find((row) => row.nodeId === "g1")?.message,
    USER_FACING.runDownstreamOriginNotRerun,
  );
  assert.equal(down.runnable.some((item) => item.nodeId === "g1"), false);
  assert.equal(down.runnable.some((item) => item.nodeId === "g2"), true);

  const sel = planRun({
    request: {
      projectId: "p",
      scope: { type: "selection", nodeIds: ["g2"] },
      force: false,
      clientRequestId: "s",
    },
    nodes,
    edges,
    loadRecipe,
  });
  assert.equal(sel.ok, true);
  assert.equal(sel.runnable.some((item) => item.nodeId === "gout"), false);
  assert.equal(sel.runnable.some((item) => item.nodeId === "g1"), false);
  assert.deepEqual(sel.runnable.map((item) => item.nodeId), ["g2"]);
});

test("成环 cycleCannotPlan 优先于全 skip 200", () => {
  const img = imageNode("img", media());
  const g1 = baseNode("g1", {
    profileId: "img2img",
    recipeId: RECIPE_IMG2IMG,
    slots: [
      { id: "g1-prompt", role: "prompt", order: 0, edgeId: null },
      { id: "g1-src", role: "source_image", order: 1, edgeId: "e12" },
    ],
  });
  const g2 = baseNode("g2", {
    profileId: "img2img",
    recipeId: RECIPE_IMG2IMG,
    slots: [
      { id: "g2-prompt", role: "prompt", order: 0, edgeId: null },
      { id: "g2-src", role: "source_image", order: 1, edgeId: "e21" },
    ],
  });
  const nodes: Record<string, ProjectNode> = { img, g1, g2 };
  const edges: Record<string, ProjectEdge> = {
    e12: edge("e12", "g2", "g1", "g1-src", "source_image"),
    e21: edge("e21", "g1", "g2", "g2-src", "source_image"),
  };
  const result = planRun({
    request: {
      projectId: "p",
      scope: { type: "selection", nodeIds: ["g1", "g2"] },
      force: true,
      clientRequestId: "cyc",
    },
    nodes,
    edges,
    loadRecipe,
  });
  assert.equal(result.ok, false);
  assert.equal(result.message, USER_FACING.cycleCannotPlan);
  assert.equal(result.message, "这些节点连成了环，没法决定先跑谁。");
});

test("选区内依赖缺输入→上游没成功，这一步没跑。选区外过期上游不进 runnable", () => {
  const img = imageNode("img", media());
  const a = baseNode("A", {
    profileId: "img2img",
    recipeId: RECIPE_IMG2IMG,
    promptDraft: "",
    slots: [
      { id: "A-prompt", role: "prompt", order: 0, edgeId: null },
      { id: "A-src", role: "source_image", order: 1, edgeId: null },
    ],
  });
  const b = baseNode("B", {
    profileId: "img2img",
    recipeId: RECIPE_IMG2IMG,
    slots: [
      { id: "B-prompt", role: "prompt", order: 0, edgeId: null },
      { id: "B-src", role: "source_image", order: 1, edgeId: "eAB" },
    ],
  });
  const outside = baseNode("out", {
    profileId: "img2img",
    recipeId: RECIPE_IMG2IMG,
    freshness: "stale",
    phase: "succeeded",
    lastSuccessFingerprint: "old",
    output: media(),
    slots: [
      { id: "out-prompt", role: "prompt", order: 0, edgeId: null },
      { id: "out-src", role: "source_image", order: 1, edgeId: "e-img" },
    ],
  });
  const nodes: Record<string, ProjectNode> = { img, A: a, B: b, out: outside };
  const edges: Record<string, ProjectEdge> = {
    eAB: edge("eAB", "A", "B", "B-src", "source_image"),
    "e-img": edge("e-img", "img", "out", "out-src", "source_image"),
  };
  const result = planRun({
    request: {
      projectId: "p",
      scope: { type: "selection", nodeIds: ["A", "B"] },
      force: false,
      clientRequestId: "dep",
    },
    nodes,
    edges,
    loadRecipe,
  });
  assert.equal(result.ok, false);
  const rowB = result.plan.nodes.find((row) => row.nodeId === "B");
  assert.equal(rowB?.action, "skip");
  assert.equal(rowB?.skipReason, "upstream_failed");
  assert.equal(rowB?.message, USER_FACING.upstreamNotRun);
  assert.equal(rowB?.message, "上游没成功，这一步没跑。");
  assert.equal(result.plan.nodes.some((row) => row.nodeId === "out"), false);

  const onlyB = planRun({
    request: {
      projectId: "p",
      scope: { type: "selection", nodeIds: ["B"] },
      force: false,
      clientRequestId: "b-only",
    },
    nodes,
    edges,
    loadRecipe,
  });
  assert.equal(onlyB.ok, false);
  assert.equal(onlyB.plan.nodes.some((row) => row.nodeId === "A"), false);
  assert.equal(onlyB.plan.nodes.find((row) => row.nodeId === "B")?.message, USER_FACING.missingSourceImage);
});

test("runUsesStaleUpstream 原文；selection force=true 点名新鲜 action=run；downstream 即使 force 仍 skip 新鲜", () => {
  const img = imageNode("img", media());
  const up = baseNode("up", {
    profileId: "img2img",
    recipeId: RECIPE_IMG2IMG,
    slots: [
      { id: "up-prompt", role: "prompt", order: 0, edgeId: null },
      { id: "up-src", role: "source_image", order: 1, edgeId: "e-img" },
    ],
  });
  const down = baseNode("down", {
    profileId: "img2img",
    recipeId: RECIPE_IMG2IMG,
    slots: [
      { id: "down-prompt", role: "prompt", order: 0, edgeId: null },
      { id: "down-src", role: "source_image", order: 1, edgeId: "e-up" },
    ],
  });
  const nodes: Record<string, ProjectNode> = { img, up, down };
  const edges: Record<string, ProjectEdge> = {
    "e-img": edge("e-img", "img", "up", "up-src", "source_image"),
    "e-up": edge("e-up", "up", "down", "down-src", "source_image"),
  };
  withSuccess(up, nodes, edges);
  nodes.up!.freshness = "stale";
  nodes.up!.lastSuccessFingerprint = "old-fp";
  nodes.up!.output = media("d".repeat(64));

  const runDown = planRun({
    request: {
      projectId: "p",
      scope: { type: "node", nodeId: "down" },
      force: false,
      clientRequestId: "stale-up",
    },
    nodes,
    edges,
    loadRecipe,
  });
  assert.equal(runDown.ok, true);
  assert.equal(runDown.plan.summary, USER_FACING.runUsesStaleUpstream);
  assert.equal(runDown.plan.summary, "将用上游当前的过期结果运行 1 个节点。");

  withSuccess(down, nodes, edges);

  const forceSel = planRun({
    request: {
      projectId: "p",
      scope: { type: "selection", nodeIds: ["down"] },
      force: true,
      clientRequestId: "force-sel",
    },
    nodes,
    edges,
    loadRecipe,
  });
  assert.equal(forceSel.ok, true);
  assert.equal(forceSel.runnable[0]?.nodeId, "down");
  assert.equal(forceSel.plan.nodes.find((row) => row.nodeId === "down")?.action, "run");

  const downScope = planRun({
    request: {
      projectId: "p",
      scope: { type: "downstream", nodeId: "up" },
      force: true,
      clientRequestId: "down-force",
    },
    nodes,
    edges,
    loadRecipe,
  });
  assert.equal(downScope.ok, true);
  const downRow = downScope.plan.nodes.find((row) => row.nodeId === "down");
  assert.equal(downRow?.action, "skip");
  assert.equal(downRow?.skipReason, "fresh");
  assert.equal(downRow?.message, USER_FACING.runSkippedFresh);
  assert.equal(downRow?.message, "当前结果还没过期，这次跳过。");
});

test("遮罩有线且配方无绑定 → slotUnsupportedMask；缺原图 missingSourceImage", () => {
  const img = imageNode("img", media());
  const maskImg = imageNode("mask", media("e".repeat(64)));
  const node = baseNode("g", {
    profileId: "img2img",
    recipeId: RECIPE_IMG2IMG,
    slots: [
      { id: "g-prompt", role: "prompt", order: 0, edgeId: null },
      { id: "g-src", role: "source_image", order: 1, edgeId: "e-src" },
      { id: "g-mask", role: "mask", order: 2, edgeId: "e-mask" },
    ],
  });
  const nodes: Record<string, ProjectNode> = { img, mask: maskImg, g: node };
  const edges: Record<string, ProjectEdge> = {
    "e-src": edge("e-src", "img", "g", "g-src", "source_image"),
    "e-mask": edge("e-mask", "mask", "g", "g-mask", "mask"),
  };
  const masked = planRun({
    request: {
      projectId: "p",
      scope: { type: "node", nodeId: "g" },
      force: false,
      clientRequestId: "mask",
    },
    nodes,
    edges,
    loadRecipe,
  });
  assert.equal(masked.ok, false);
  assert.equal(masked.message, USER_FACING.slotUnsupportedMask);
  assert.equal(nodes.g?.slots?.find((slot) => slot.role === "mask")?.edgeId, "e-mask");

  node.slots = [
    { id: "g-prompt", role: "prompt", order: 0, edgeId: null },
    { id: "g-src", role: "source_image", order: 1, edgeId: null },
  ];
  const missing = planRun({
    request: {
      projectId: "p",
      scope: { type: "node", nodeId: "g" },
      force: false,
      clientRequestId: "no-src",
    },
    nodes,
    edges: {},
    loadRecipe,
  });
  assert.equal(missing.ok, false);
  assert.equal(missing.message, USER_FACING.missingSourceImage);
});

test("reference 缺参考图；有一张则 run。多点名新鲜 skip 不是 200 跑完", () => {
  const img = imageNode("img", media());
  const ref = baseNode("r", {
    profileId: "reference",
    recipeId: RECIPE_REFERENCE,
    slots: [
      { id: "r-prompt", role: "prompt", order: 0, edgeId: null },
      { id: "r-ref", role: "reference_image", order: 1, edgeId: null },
    ],
  });
  const nodes: Record<string, ProjectNode> = { img, r: ref };
  const missing = planRun({
    request: {
      projectId: "p",
      scope: { type: "node", nodeId: "r" },
      force: false,
      clientRequestId: "no-ref",
    },
    nodes,
    edges: {},
    loadRecipe,
  });
  assert.equal(missing.ok, false);
  assert.equal(missing.message, USER_FACING.missingReferenceImage);

  ref.slots = [
    { id: "r-prompt", role: "prompt", order: 0, edgeId: null },
    { id: "r-ref", role: "reference_image", order: 1, edgeId: "e-ref" },
  ];
  const edges: Record<string, ProjectEdge> = {
    "e-ref": edge("e-ref", "img", "r", "r-ref", "reference_image"),
  };
  const ok = planRun({
    request: {
      projectId: "p",
      scope: { type: "node", nodeId: "r" },
      force: false,
      clientRequestId: "ref-ok",
    },
    nodes,
    edges,
    loadRecipe,
  });
  assert.equal(ok.ok, true);
  assert.equal(ok.runnable[0]?.nodeId, "r");

  const a = withSuccess(baseNode("a"), { a: baseNode("a") }, {});
  const b = withSuccess(baseNode("b"), { b: baseNode("b") }, {});
  const multi = planRun({
    request: {
      projectId: "p",
      scope: { type: "selection", nodeIds: ["a", "b"] },
      force: false,
      clientRequestId: "multi-fresh",
    },
    nodes: { a, b },
    edges: {},
    loadRecipe,
  });
  assert.equal(multi.ok, false);
  assert.equal(multi.message, USER_FACING.runSkippedFresh);
});
