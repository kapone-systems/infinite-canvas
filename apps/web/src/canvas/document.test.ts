/// <reference types="node" />
import assert from "node:assert/strict";
import { test } from "node:test";
import type { ProjectGroup, ProjectNode } from "@canvas/schema";
import { createEmptyProject, RECIPE_TXT2IMG } from "@canvas/schema";
import {
  cloneSubgraphForPaste,
  createEmptyGenerationShell,
  createGenerationNode,
  edgesWithBothEndsIn,
  expandSelectionToNodes,
  selectionContainsNode,
} from "./document.ts";
import {
  COPY_OFFSET,
  GENERATION_ADD_SLOT_ROW,
  GENERATION_PAD,
  GENERATION_PREVIEW_MIN,
  GENERATION_VARIANT_STRIP,
  generationNodeHeight,
  HEADER,
  SLOT_ROW,
} from "./metrics.ts";

const NOW = new Date("2026-09-24T00:00:00.000Z");

test("工厂：文生图仍 1 prompt 且 recipeId=recipe.image.txt2img.fictional", () => {
  let n = 0;
  const node = createGenerationNode({
    profileId: "txt2img",
    idFactory: () => `s${++n}`,
    id: "g1",
    title: "文生图 1",
    x: 10,
    y: 20,
    z: 1,
    now: NOW,
  });
  assert.ok(node);
  assert.equal(node.kind, "generation");
  assert.equal(node.slots?.length, 1);
  assert.equal(node.slots?.[0]?.role, "prompt");
  assert.equal(node.slots?.[0]?.edgeId, null);
  assert.equal(node.recipeId, RECIPE_TXT2IMG);
  assert.equal(node.recipeId, "recipe.image.txt2img.fictional");
  assert.equal(node.params?.seed, "random");
  assert.equal(node.phase, "idle");
  assert.equal(node.height, generationNodeHeight(1, 0));
  assert.equal(HEADER, 40);
  assert.equal(SLOT_ROW, 36);
  const emptyHeight = generationNodeHeight(1, 0);
  const successHeight = generationNodeHeight(1, 4);
  assert.equal(
    emptyHeight,
    HEADER + SLOT_ROW + GENERATION_ADD_SLOT_ROW + GENERATION_PREVIEW_MIN + GENERATION_PAD,
  );
  assert.equal(successHeight, emptyHeight + GENERATION_VARIANT_STRIP);
  assert.equal(GENERATION_PREVIEW_MIN, 120);
  assert.equal(GENERATION_VARIANT_STRIP, 72);
});

test("工厂：图生图默认 prompt+source_image；参考图默认 prompt+1 参考图", () => {
  let n = 0;
  const img = createGenerationNode({
    profileId: "img2img",
    idFactory: () => `i${++n}`,
    id: "img",
    title: "图生图",
    x: 0,
    y: 0,
    z: 1,
    now: NOW,
  });
  assert.ok(img);
  assert.deepEqual(img.slots?.map((slot) => slot.role), ["prompt", "source_image"]);
  assert.equal(img.recipeId, "recipe.image.img2img.fictional");

  n = 0;
  const ref = createGenerationNode({
    profileId: "reference",
    idFactory: () => `r${++n}`,
    id: "ref",
    title: "参考图生成",
    x: 0,
    y: 0,
    z: 1,
    now: NOW,
  });
  assert.ok(ref);
  assert.deepEqual(ref.slots?.map((slot) => slot.role), ["prompt", "reference_image"]);
  assert.equal(ref.slots?.some((slot) => slot.role === "style_reference"), false);
  assert.equal(ref.recipeId, "recipe.image.reference.fictional");
});

test("空生成外壳走工厂：槽 + 高度公式，没有运行结果", () => {
  const node = createEmptyGenerationShell({
    id: "g1",
    title: "生成 1",
    x: 10,
    y: 20,
    z: 1,
    now: NOW,
    slotId: "s0",
  });
  assert.equal(node.kind, "generation");
  assert.equal(node.slots?.length, 1);
  assert.equal(node.slots?.[0]?.role, "prompt");
  assert.equal(node.slots?.[0]?.id, "s0");
  assert.equal(node.recipeId, "recipe.image.txt2img.fictional");
  assert.equal(node.height, generationNodeHeight(1, 0));
});

test("粘贴只复制内部边，新 id，偏移 24", () => {
  const project = createEmptyProject({
    projectId: "p",
    name: "p",
    now: NOW,
  });
  const a = createEmptyGenerationShell({
    id: "a",
    title: "A",
    x: 0,
    y: 0,
    z: 1,
    now: NOW,
    slotId: "sa",
  });
  const b = createEmptyGenerationShell({
    id: "b",
    title: "B",
    x: 400,
    y: 0,
    z: 2,
    now: NOW,
    slotId: "sb",
    edgeId: "e-in",
  });
  const c = createEmptyGenerationShell({
    id: "c",
    title: "C",
    x: 400,
    y: 400,
    z: 3,
    now: NOW,
    slotId: "sc",
    edgeId: "e-out",
  });
  project.nodes = { a, b, c };
  project.edges = {
    "e-in": {
      id: "e-in",
      sourceNodeId: "a",
      targetNodeId: "b",
      targetSlotId: "sb",
      role: "prompt",
    },
    "e-out": {
      id: "e-out",
      sourceNodeId: "a",
      targetNodeId: "c",
      targetSlotId: "sc",
      role: "prompt",
    },
  };
  let n = 0;
  const cloned = cloneSubgraphForPaste({
    nodes: project.nodes,
    edges: project.edges,
    groups: {},
    selectedIds: ["a", "b"],
    idFactory: () => `n${n++}`,
  });
  assert.equal(cloned.newNodeIds.length, 2);
  assert.equal(Object.keys(cloned.edges).length, 1);
  const internal = edgesWithBothEndsIn(cloned.edges, cloned.newNodeIds);
  assert.equal(internal.length, 1);
  const pastedB = Object.values(cloned.nodes).find((node) => node.title === "B");
  const srcB = project.nodes["b"];
  assert.ok(pastedB && srcB);
  assert.equal(pastedB.x, srcB.x + COPY_OFFSET);
  assert.equal(pastedB.y, srcB.y + COPY_OFFSET);
  assert.notEqual(pastedB.id, "b");
  assert.equal(pastedB.slots?.[0]?.id === "sb", false);
});

test("选中分组后，成员节点仍算在选择里，拖组才能跟手", () => {
  const a = createEmptyGenerationShell({
    id: "a",
    title: "A",
    x: 0,
    y: 0,
    z: 1,
    now: NOW,
    slotId: "sa",
    groupId: "g",
  });
  const b = createEmptyGenerationShell({
    id: "b",
    title: "B",
    x: 40,
    y: 0,
    z: 2,
    now: NOW,
    slotId: "sb",
    groupId: "g",
  });
  const nodes: Record<string, ProjectNode> = { a, b };
  const groups: Record<string, ProjectGroup> = { g: { id: "g", title: "分组", childIds: ["a", "b"] } };
  assert.deepEqual(expandSelectionToNodes(nodes, groups, ["g"]).sort(), ["a", "b"]);
  assert.equal(selectionContainsNode(nodes, groups, ["g"], "a"), true);
  assert.equal(selectionContainsNode(nodes, groups, ["g"], "b"), true);
  assert.equal(selectionContainsNode(nodes, groups, ["g"], "missing"), false);
  assert.equal(selectionContainsNode(nodes, groups, ["a"], "a"), true);
  assert.equal(selectionContainsNode(nodes, groups, ["a"], "b"), false);
});
