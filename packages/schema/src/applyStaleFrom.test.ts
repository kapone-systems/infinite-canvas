import assert from "node:assert/strict";
import { test } from "node:test";
import { applyStaleFrom } from "./applyStaleFrom.ts";
import type { ProjectEdge, ProjectNode } from "./types.ts";
import { USER_FACING } from "./userFacingMessages.ts";

function textNode(id: string): ProjectNode {
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
    text: "一只纸船",
    freshness: "fresh",
    phase: "idle",
  };
}

function gen(id: string, slotEdge: string | null): ProjectNode {
  return {
    id,
    kind: "generation",
    title: id,
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
    promptDraft: "草稿",
    slots: [{ id: `${id}-p`, role: "prompt", order: 0, edgeId: slotEdge }],
    phase: "idle",
    freshness: "fresh",
    lastSuccessFingerprint: "fp",
  };
}

test("改文本节点下游过期自己不过期；不入队", () => {
  const nodes: Record<string, ProjectNode> = {
    t: textNode("t"),
    g: gen("g", "e1"),
  };
  const edges: Record<string, ProjectEdge> = {
    e1: {
      id: "e1",
      sourceNodeId: "t",
      targetNodeId: "g",
      targetSlotId: "g-p",
      role: "prompt",
    },
  };
  const marked = applyStaleFrom(nodes, edges, "t");
  assert.deepEqual(marked, ["g"]);
  assert.equal(nodes.t?.freshness, "fresh");
  assert.equal(nodes.g?.freshness, "stale");
  assert.equal(nodes.g?.phase, "idle");
  assert.equal(USER_FACING.staleHover, "上游改过了，不会自动重跑。");
});

test("只标下游不含起点；目标须调用方再标一次", () => {
  const nodes: Record<string, ProjectNode> = {
    g1: gen("g1", null),
    g2: gen("g2", "e2"),
  };
  nodes.g2!.slots = [{ id: "g2-src", role: "source_image", order: 0, edgeId: "e2" }];
  const edges: Record<string, ProjectEdge> = {
    e2: {
      id: "e2",
      sourceNodeId: "g1",
      targetNodeId: "g2",
      targetSlotId: "g2-src",
      role: "source_image",
    },
  };
  applyStaleFrom(nodes, edges, "g1");
  assert.equal(nodes.g1?.freshness, "fresh");
  assert.equal(nodes.g2?.freshness, "stale");
});
