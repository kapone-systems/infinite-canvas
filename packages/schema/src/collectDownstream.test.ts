import assert from "node:assert/strict";
import { test } from "node:test";
import { collectDownstream } from "./collectDownstream.ts";
import type { ProjectEdge, ProjectNode } from "./types.ts";

function node(id: string, kind: ProjectNode["kind"]): ProjectNode {
  return {
    id,
    kind,
    title: id,
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
    slots: kind === "generation" ? [{ id: `${id}-s`, role: "prompt", order: 0, edgeId: null }] : undefined,
  };
}

function edge(id: string, source: string, target: string): ProjectEdge {
  return {
    id,
    sourceNodeId: source,
    targetNodeId: target,
    targetSlotId: `${target}-s`,
    role: "prompt",
  };
}

test("不含起点；穿过素材继续", () => {
  const nodes: Record<string, ProjectNode> = {
    t: node("t", "text"),
    img: node("img", "image"),
    g1: node("g1", "generation"),
    g2: node("g2", "generation"),
  };
  const edges: Record<string, ProjectEdge> = {
    e1: edge("e1", "t", "img"),
    e2: edge("e2", "img", "g1"),
    e3: edge("e3", "g1", "g2"),
  };
  const fromT = collectDownstream("t", nodes, edges);
  assert.equal(fromT.includes("t"), false);
  assert.equal(fromT.includes("img"), false);
  assert.deepEqual(fromT, ["g1", "g2"]);
  assert.deepEqual(collectDownstream("g1", nodes, edges), ["g2"]);
  assert.equal(collectDownstream("g1", nodes, edges).includes("g1"), false);
  assert.deepEqual(collectDownstream("g2", nodes, edges), []);
});
