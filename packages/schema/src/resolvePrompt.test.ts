import assert from "node:assert/strict";
import { test } from "node:test";
import { resolvePrompt } from "./resolvePrompt.ts";
import type { ProjectEdge, ProjectNode } from "./types.ts";

function textNode(id: string, text: string): ProjectNode {
  return {
    id,
    kind: "text",
    title: "文本",
    x: 0,
    y: 0,
    width: 280,
    height: 180,
    z: 1,
    groupId: null,
    origin: "authored",
    createdAt: "2026-09-24T00:00:00.000Z",
    updatedAt: "2026-09-24T00:00:00.000Z",
    outputRevision: 1,
    text,
  };
}

function gen(id: string, draft: string, slotEdge: string | null): ProjectNode {
  return {
    id,
    kind: "generation",
    title: "文生图",
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
    profileId: "txt2img",
    slots: [{ id: "slot-p", role: "prompt", order: 0, edgeId: slotEdge }],
    phase: "idle",
    freshness: "fresh",
  };
}

test("有 prompt 边用源 text 不回落草稿", () => {
  const nodes: Record<string, ProjectNode> = {
    t: textNode("t", "一只纸船"),
    g: gen("g", "草稿不该出现", "e1"),
  };
  const edges: Record<string, ProjectEdge> = {
    e1: {
      id: "e1",
      sourceNodeId: "t",
      targetNodeId: "g",
      targetSlotId: "slot-p",
      role: "prompt",
    },
  };
  assert.equal(resolvePrompt(nodes.g!, nodes, edges), "一只纸船");
});

test("源是空字符串也用空字符串，不用草稿顶上", () => {
  const nodes: Record<string, ProjectNode> = {
    t: textNode("t", ""),
    g: gen("g", "草稿", "e1"),
  };
  const edges: Record<string, ProjectEdge> = {
    e1: {
      id: "e1",
      sourceNodeId: "t",
      targetNodeId: "g",
      targetSlotId: "slot-p",
      role: "prompt",
    },
  };
  assert.equal(resolvePrompt(nodes.g!, nodes, edges), "");
});

test("无连线用 promptDraft", () => {
  const nodes: Record<string, ProjectNode> = {
    g: gen("g", "只用草稿", null),
  };
  assert.equal(resolvePrompt(nodes.g!, nodes, {}), "只用草稿");
});
