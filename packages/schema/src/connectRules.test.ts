import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluateConnect, wouldCreateCycle } from "./connectRules.ts";
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
    text: "提示词",
  };
}

function videoNode(id: string): ProjectNode {
  return {
    id,
    kind: "video",
    title: "视频",
    x: 0,
    y: 0,
    width: 320,
    height: 180,
    z: 1,
    groupId: null,
    origin: "imported",
    createdAt: "2026-09-24T00:00:00.000Z",
    updatedAt: "2026-09-24T00:00:00.000Z",
    outputRevision: 1,
  };
}

function gen(
  id: string,
  slots: ProjectNode["slots"],
  outputKind: ProjectNode["outputKind"] = "image",
): ProjectNode {
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
    outputKind,
    slots,
    phase: "idle",
    freshness: "fresh",
  };
}

test("roleMismatch 文本→参考图", () => {
  const nodes: Record<string, ProjectNode> = {
    t: textNode("t"),
    g: gen("g", [{ id: "ref", role: "reference_image", order: 1, edgeId: null }]),
  };
  const result = evaluateConnect({
    nodes,
    edges: {},
    sourceNodeId: "t",
    target: { type: "slot", nodeId: "g", slotId: "ref" },
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.message, "这里要的是参考图，这条线是提示词");
    assert.equal(result.message, USER_FACING.textToReferenceImage);
  }
});

test("音频拖到参考图槽回弹，句子含音频参考和参考图；别的槽仍是种类不合", () => {
  const audio: ProjectNode = {
    ...textNode("a"),
    kind: "audio",
    text: undefined,
  };
  const nodes: Record<string, ProjectNode> = {
    a: audio,
    g: gen("g", [
      { id: "ref", role: "reference_image", order: 0, edgeId: null },
      { id: "prompt", role: "prompt", order: 1, edgeId: null },
      { id: "first", role: "first_frame", order: 2, edgeId: null },
    ]),
  };
  const bounced = evaluateConnect({
    nodes,
    edges: {},
    sourceNodeId: "a",
    target: { type: "slot", nodeId: "g", slotId: "ref" },
  });
  assert.equal(bounced.ok, false);
  if (!bounced.ok) {
    assert.equal(bounced.message, "这里要的是参考图，这条线是音频参考");
    assert.equal(bounced.message, USER_FACING.audioToReferenceImage);
    assert.equal(bounced.message.includes("音频参考"), true);
    assert.equal(bounced.message.includes("参考图"), true);
  }
  const prompt = evaluateConnect({
    nodes,
    edges: {},
    sourceNodeId: "a",
    target: { type: "slot", nodeId: "g", slotId: "prompt" },
  });
  assert.equal(prompt.ok, false);
  if (!prompt.ok) {
    assert.equal(prompt.message, USER_FACING.kindMismatch("音频", "提示词"));
    assert.equal(prompt.message.includes("音频参考"), false);
  }
  const frame = evaluateConnect({
    nodes,
    edges: {},
    sourceNodeId: "a",
    target: { type: "slot", nodeId: "g", slotId: "first" },
  });
  assert.equal(frame.ok, false);
  if (!frame.ok) {
    assert.equal(frame.message, USER_FACING.kindMismatch("音频", "首帧"));
  }
});

test("自环 / 成环 / 视频句 / 空白 / 远景", () => {
  const nodes: Record<string, ProjectNode> = {
    t: textNode("t"),
    v: videoNode("v"),
    a: gen("a", [{ id: "a-src", role: "source_image", order: 0, edgeId: null }]),
    b: gen("b", [{ id: "b-src", role: "source_image", order: 0, edgeId: "e-ab" }]),
  };
  const edges: Record<string, ProjectEdge> = {
    "e-ab": {
      id: "e-ab",
      sourceNodeId: "a",
      targetNodeId: "b",
      targetSlotId: "b-src",
      role: "source_image",
    },
  };
  const self = evaluateConnect({
    nodes,
    edges,
    sourceNodeId: "a",
    target: { type: "slot", nodeId: "a", slotId: "a-src" },
  });
  assert.equal(self.ok, false);
  if (!self.ok) {
    assert.equal(self.message, "不能连到自己");
  }

  const cycle = evaluateConnect({
    nodes,
    edges,
    sourceNodeId: "b",
    target: { type: "slot", nodeId: "a", slotId: "a-src" },
  });
  assert.equal(cycle.ok, false);
  if (!cycle.ok) {
    assert.equal(cycle.message, "会形成循环，已取消");
  }
  assert.equal(wouldCreateCycle("b", "a", edges), true);

  const video = evaluateConnect({
    nodes,
    edges,
    sourceNodeId: "v",
    target: { type: "slot", nodeId: "a", slotId: "a-src" },
  });
  assert.equal(video.ok, false);
  if (!video.ok) {
    assert.equal(
      video.message,
      "视频结果现在还不能接到别的槽上。要用画面的话，拖首帧或尾帧。",
    );
  }

  const kind = evaluateConnect({
    nodes: {
      v: videoNode("v"),
      g: gen("g", [{ id: "p", role: "prompt", order: 0, edgeId: null }]),
    },
    edges: {},
    sourceNodeId: "v",
    target: { type: "slot", nodeId: "g", slotId: "p" },
  });
  assert.equal(kind.ok, false);

  const blank = evaluateConnect({
    nodes,
    edges,
    sourceNodeId: "t",
    target: { type: "empty" },
  });
  assert.equal(blank.ok, false);
  if (!blank.ok) {
    assert.equal(blank.message, "要连到槽上，已取消");
  }

  const far = evaluateConnect({
    nodes,
    edges,
    sourceNodeId: "t",
    target: { type: "far" },
  });
  assert.equal(far.ok, false);
  if (!far.ok) {
    assert.equal(far.message, "放大到能看清槽之后再松开");
  }
});

test("种类不合：不能把视频接到提示词槽；占用则替换", () => {
  const mismatch = USER_FACING.kindMismatch("视频", "提示词");
  assert.equal(mismatch, "不能把「视频」接到「提示词」槽");
  const nodes: Record<string, ProjectNode> = {
    t: textNode("t"),
    g: gen("g", [{ id: "p", role: "prompt", order: 0, edgeId: "old" }]),
  };
  const edges: Record<string, ProjectEdge> = {
    old: {
      id: "old",
      sourceNodeId: "other",
      targetNodeId: "g",
      targetSlotId: "p",
      role: "prompt",
    },
  };
  const ok = evaluateConnect({
    nodes: { ...nodes, other: textNode("other") },
    edges,
    sourceNodeId: "t",
    target: { type: "slot", nodeId: "g", slotId: "p" },
  });
  assert.equal(ok.ok, true);
  if (ok.ok) {
    assert.equal(ok.replace, true);
  }
});
