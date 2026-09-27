import assert from "node:assert/strict";
import { test } from "node:test";
import { fingerprint, fingerprintNode } from "./fingerprint.ts";
import { sha256Hex } from "./sha256.ts";
import { RANDOM_SEED } from "./types.ts";
import type { ProjectEdge, ProjectNode } from "./types.ts";

test("同步 sha256 已知向量，不依赖 node:crypto", () => {
  assert.equal(
    sha256Hex(""),
    "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  );
  assert.equal(
    sha256Hex("abc"),
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  );
});

test("存储种子 ASCII random；规范化 JSON 与键顺序无关", () => {
  const a = fingerprint({
    recipeId: "recipe.image.txt2img.fictional",
    recipeVersion: 1,
    params: { seed: RANDOM_SEED, width: 1024, height: 1024 },
    variantCount: 1,
    slots: [{ role: "prompt", order: 0, text: "一只纸船", contentHash: null }],
  });
  const b = fingerprint({
    recipeId: "recipe.image.txt2img.fictional",
    recipeVersion: 1,
    params: { height: 1024, seed: "随机", width: 1024 },
    variantCount: 1,
    slots: [{ contentHash: null, role: "prompt", text: "一只纸船", order: 0 }],
  });
  assert.equal(a, b);
  assert.equal(a.length, 64);
  const other = fingerprint({
    recipeId: "recipe.image.txt2img.fictional",
    recipeVersion: 1,
    params: { seed: RANDOM_SEED, width: 1024, height: 1024 },
    variantCount: 1,
    slots: [{ role: "prompt", order: 0, text: "一只纸船。", contentHash: null }],
  });
  assert.notEqual(a, other);
});

test("坐标不进指纹；有边用源 text", () => {
  const base = (text: string, x: number): ProjectNode => ({
    id: "t",
    kind: "text",
    title: "文本",
    x,
    y: 99,
    width: 280,
    height: 180,
    z: 1,
    groupId: null,
    origin: "authored",
    createdAt: "2026-09-24T00:00:00.000Z",
    updatedAt: "2026-09-24T00:00:00.000Z",
    outputRevision: 1,
    text,
  });
  const gen = (draft: string): ProjectNode => ({
    id: "g",
    kind: "generation",
    title: "生成",
    x: 400,
    y: 0,
    width: 320,
    height: 240,
    z: 2,
    groupId: null,
    origin: "authored",
    createdAt: "2026-09-24T00:00:00.000Z",
    updatedAt: "2026-09-24T00:00:00.000Z",
    outputRevision: 1,
    promptDraft: draft,
    recipeId: "recipe.image.txt2img.fictional",
    recipeVersion: 1,
    params: { seed: RANDOM_SEED },
    variantCount: 1,
    slots: [{ id: "p", role: "prompt", order: 0, edgeId: "e1" }],
  });
  const edges: Record<string, ProjectEdge> = {
    e1: {
      id: "e1",
      sourceNodeId: "t",
      targetNodeId: "g",
      targetSlotId: "p",
      role: "prompt",
    },
  };
  const nodesA: Record<string, ProjectNode> = { t: base("一只纸船", 0), g: gen("草稿") };
  const nodesB: Record<string, ProjectNode> = { t: base("一只纸船", 880), g: gen("另一草稿") };
  assert.equal(fingerprintNode(nodesA.g!, nodesA, edges), fingerprintNode(nodesB.g!, nodesB, edges));
});
