/// <reference types="node" />
import assert from "node:assert/strict";
import { test } from "node:test";
import type { Camera } from "@canvas/schema";
import { worldToScreen, type Size } from "./coords.ts";
import {
  hitTest,
  marqueeHitsNode,
  marqueeModeFromAlt,
  outputPortWorld,
  overlapSlotNotGroupFixture,
  slotWorldRect,
  type HitNode,
} from "./hitTest.ts";
import {
  EDGE_HIT,
  MARQUEE_DEFAULT_MODE,
  MARQUEE_MODE_CONTAIN,
  MARQUEE_MODE_INTERSECT,
  OUTPUT_ANCHOR_Y,
  PORT,
  SLOT_HIT_CSS_PX,
  SLOT_HIT_EXPAND,
  outputAnchorLocal,
} from "./metrics.ts";

const VIEW: Size = { width: 1280, height: 720 };
const CAMERA: Camera = { x: 0, y: 0, zoom: 1 };

function hitAt(
  world: { x: number; y: number },
  extra: Partial<Parameters<typeof hitTest>[0]> = {},
): ReturnType<typeof hitTest> {
  return hitTest({
    world,
    screen: worldToScreen(world, extra.camera ?? CAMERA, extra.viewport ?? VIEW),
    camera: CAMERA,
    viewport: VIEW,
    connecting: false,
    mountedIds: new Set(),
    nodes: [],
    ...extra,
  });
}

test("命中顺序：覆盖层先于槽、节点、边、组、空白", () => {
  const node: HitNode = { id: "n1", x: 0, y: 0, width: 80, height: 80, z: 1 };
  const world = { x: 10, y: 10 };
  const screen = worldToScreen(world, CAMERA, VIEW);
  const overlayHit = hitAt(world, {
    mountedIds: new Set(["n1"]),
    nodes: [node],
    overlays: [{ id: "menu", x: screen.x - 4, y: screen.y - 4, width: 20, height: 20 }],
    slots: [{ nodeId: "n1", slotId: "s0", x: 0, y: 0, width: 80, height: 40 }],
    groups: [{ id: "g1", x: -10, y: -10, width: 120, height: 120 }],
  });
  assert.deepEqual(overlayHit, { kind: "overlay", id: "menu" });
});

test("重叠夹具：同一点选中槽不是组", () => {
  const fx = overlapSlotNotGroupFixture();
  assert.ok(fx.world.x >= fx.group.x);
  assert.ok(fx.world.x <= fx.group.x + fx.group.width);
  assert.ok(fx.world.y >= fx.group.y);
  assert.ok(fx.world.y <= fx.group.y + fx.group.height);
  const slotRect = slotWorldRect(fx.gen, 0);
  assert.ok(fx.world.y >= slotRect.y && fx.world.y <= slotRect.y + slotRect.height);
  const hit = hitTest({
    world: fx.world,
    screen: fx.screen,
    camera: fx.camera,
    viewport: fx.viewport,
    connecting: false,
    mountedIds: new Set([fx.gen.id, fx.child.id]),
    nodes: [fx.gen, fx.child],
    slots: [fx.slot],
    groups: [fx.group],
  });
  assert.deepEqual(hit, { kind: "slot", nodeId: fx.gen.id, slotId: fx.slot.slotId });
  assert.notEqual(hit.kind, "group");
});

test("连线时槽热区扩 12px，未连线时不扩", () => {
  const gen: HitNode = { id: "g", x: 0, y: 0, width: 320, height: 232, z: 1 };
  const slot = { nodeId: "g", slotId: "s0", ...slotWorldRect(gen, 0) };
  const justAbove = { x: 40, y: slot.y - 1 };
  const idle = hitAt(justAbove, {
    mountedIds: new Set(["g"]),
    nodes: [gen],
    slots: [slot],
  });
  assert.deepEqual(idle, { kind: "near-node", nodeId: "g" });
  const connecting = hitAt(justAbove, {
    connecting: true,
    mountedIds: new Set(["g"]),
    nodes: [gen],
    slots: [slot],
  });
  assert.deepEqual(connecting, { kind: "slot", nodeId: "g", slotId: "s0" });
  assert.equal(SLOT_HIT_EXPAND, 12);
  const tooFar = { x: 40, y: slot.y - SLOT_HIT_EXPAND - 1 };
  const stillNode = hitAt(tooFar, {
    connecting: true,
    mountedIds: new Set(["g"]),
    nodes: [gen],
    slots: [slot],
  });
  assert.deepEqual(stillNode, { kind: "near-node", nodeId: "g" });
});

test("近景 DOM 先于远景色块；远景色块先于边", () => {
  const near: HitNode = { id: "near", x: 0, y: 0, width: 40, height: 40, z: 1 };
  const far: HitNode = { id: "far", x: 80, y: 0, width: 40, height: 40, z: 2 };
  assert.deepEqual(
    hitAt({ x: 10, y: 10 }, { mountedIds: new Set(["near"]), nodes: [near, far] }),
    { kind: "near-node", nodeId: "near" },
  );
  assert.deepEqual(
    hitAt({ x: 90, y: 10 }, { mountedIds: new Set(["near"]), nodes: [near, far] }),
    { kind: "far-block", nodeId: "far" },
  );
  const onFar = hitAt(
    { x: 90, y: 10 },
    {
      mountedIds: new Set(["near"]),
      nodes: [near, far],
      edges: [{ id: "e1", points: [{ x: 70, y: 10 }, { x: 140, y: 10 }] }],
    },
  );
  assert.deepEqual(onFar, { kind: "far-block", nodeId: "far" });
});

test("边命中容差 8px；已选中的边在容差内优先", () => {
  assert.equal(EDGE_HIT, 8);
  const edgeA = { id: "ea", points: [{ x: -40, y: 0 }, { x: 40, y: 0 }] };
  const edgeB = { id: "eb", points: [{ x: -40, y: 4 }, { x: 40, y: 4 }] };
  assert.deepEqual(hitAt({ x: 0, y: 0 }, { edges: [edgeA] }), { kind: "edge", edgeId: "ea" });
  assert.deepEqual(hitAt({ x: 0, y: EDGE_HIT }, { edges: [edgeA] }), { kind: "edge", edgeId: "ea" });
  assert.deepEqual(hitAt({ x: 0, y: EDGE_HIT + 1 }, { edges: [edgeA] }), { kind: "empty" });
  const preferSelected = hitAt(
    { x: 0, y: 0 },
    { edges: [edgeA, edgeB], selectedEdgeIds: new Set(["eb"]) },
  );
  assert.deepEqual(preferSelected, { kind: "edge", edgeId: "eb" });
});

test("点在分组留白上才是组；子节点身上不是组", () => {
  const fx = overlapSlotNotGroupFixture();
  const onPad = { x: fx.group.x + 8, y: fx.group.y + 2 };
  assert.ok(onPad.y < fx.gen.y);
  const groupHit = hitTest({
    world: onPad,
    screen: worldToScreen(onPad, fx.camera, fx.viewport),
    camera: fx.camera,
    viewport: fx.viewport,
    connecting: false,
    mountedIds: new Set([fx.child.id]),
    nodes: [fx.gen, fx.child],
    slots: [fx.slot],
    groups: [fx.group],
  });
  assert.deepEqual(groupHit, { kind: "group", groupId: fx.group.id });
  const onChild = { x: fx.child.x + 10, y: fx.child.y + 10 };
  const childHit = hitTest({
    world: onChild,
    screen: worldToScreen(onChild, fx.camera, fx.viewport),
    camera: fx.camera,
    viewport: fx.viewport,
    connecting: false,
    mountedIds: new Set([fx.child.id]),
    nodes: [fx.gen, fx.child],
    groups: [fx.group],
  });
  assert.deepEqual(childHit, { kind: "near-node", nodeId: fx.child.id });
});

test("连接桩热区至少 24×24 CSS 像素", () => {
  assert.equal(PORT, 24);
  assert.equal(SLOT_HIT_CSS_PX, 24);
  assert.equal(OUTPUT_ANCHOR_Y, 48);
  assert.deepEqual(outputAnchorLocal(320), { x: 320, y: 48 });
  const node: HitNode = { id: "p", x: 0, y: 0, width: 320, height: 180, z: 1 };
  const port = outputPortWorld(node);
  assert.equal(port.y, 48);
  const half = PORT / 2;
  const inside = { x: port.x + half, y: port.y };
  const outside = { x: port.x + half + 1, y: port.y };
  assert.deepEqual(
    hitAt(inside, { nodes: [node], outputs: [{ nodeId: node.id, ...port }] }),
    { kind: "output", nodeId: "p" },
  );
  const miss = hitAt(outside, { nodes: [node], outputs: [{ nodeId: node.id, ...port }] });
  assert.notEqual(miss.kind, "output");
  const zoomed: Camera = { x: 0, y: 0, zoom: 2 };
  const screenInside = worldToScreen(port, zoomed, VIEW);
  screenInside.x += half - 0.5;
  const worldFromScreen = {
    x: (screenInside.x - VIEW.width / 2) / zoomed.zoom + zoomed.x,
    y: (screenInside.y - VIEW.height / 2) / zoomed.zoom + zoomed.y,
  };
  const zoomHit = hitTest({
    world: worldFromScreen,
    screen: screenInside,
    camera: zoomed,
    viewport: VIEW,
    connecting: false,
    mountedIds: new Set(),
    nodes: [node],
    outputs: [{ nodeId: node.id, ...port }],
  });
  assert.deepEqual(zoomHit, { kind: "output", nodeId: "p" });
});

test("重叠节点取 z 最大，平局取 id 字典序较大", () => {
  const a: HitNode = { id: "a", x: 0, y: 0, width: 40, height: 40, z: 1 };
  const b: HitNode = { id: "b", x: 0, y: 0, width: 40, height: 40, z: 2 };
  const c: HitNode = { id: "c", x: 0, y: 0, width: 40, height: 40, z: 2 };
  assert.deepEqual(hitAt({ x: 5, y: 5 }, { nodes: [a, b] }), { kind: "far-block", nodeId: "b" });
  assert.deepEqual(hitAt({ x: 5, y: 5 }, { nodes: [b, c] }), { kind: "far-block", nodeId: "c" });
});

test("叠在上面的节点挡住下面的槽，点在内部拖的是上面那张", () => {
  const lower: HitNode = { id: "lower", x: 0, y: 0, width: 320, height: 240, z: 1 };
  const upper: HitNode = { id: "upper", x: 40, y: 20, width: 200, height: 120, z: 2 };
  const slot = { nodeId: "lower", slotId: "s0", x: 0, y: 40, width: 320, height: 36, role: "prompt" as const, order: 0 };
  const point = { x: 80, y: 50 };
  assert.ok(point.x > upper.x && point.x < upper.x + upper.width);
  assert.ok(point.y >= slot.y && point.y <= slot.y + slot.height);
  assert.deepEqual(
    hitAt(point, {
      nodes: [lower, upper],
      slots: [slot],
      mountedIds: new Set(["lower", "upper"]),
    }),
    { kind: "near-node", nodeId: "upper" },
  );
});

test("叠在上面的输出口不被下面的槽抢走", () => {
  const lower: HitNode = { id: "lower", x: 0, y: 0, width: 400, height: 240, z: 1 };
  const upper: HitNode = { id: "upper", x: 20, y: 10, width: 280, height: 160, z: 3 };
  const port = outputPortWorld(upper);
  const slot = { nodeId: "lower", slotId: "s0", x: 0, y: 40, width: 400, height: 36, role: "prompt" as const, order: 0 };
  assert.equal(port.x, upper.x + upper.width);
  assert.ok(port.y >= slot.y && port.y <= slot.y + slot.height);
  assert.deepEqual(
    hitAt(port, {
      nodes: [lower, upper],
      slots: [slot],
      outputs: [{ nodeId: upper.id, ...port }],
    }),
    { kind: "output", nodeId: "upper" },
  );
});

test("上面那张自己的槽仍先于它的身体", () => {
  const upper: HitNode = { id: "upper", x: 0, y: 0, width: 320, height: 240, z: 2 };
  const lower: HitNode = { id: "lower", x: 0, y: 0, width: 320, height: 240, z: 1 };
  const slot = { nodeId: "upper", slotId: "s-up", ...slotWorldRect(upper, 0), role: "prompt" as const, order: 0 };
  const buried = { nodeId: "lower", slotId: "s-low", ...slotWorldRect(lower, 0), role: "prompt" as const, order: 0 };
  const point = { x: 48, y: slot.y + 8 };
  assert.deepEqual(
    hitAt(point, { nodes: [lower, upper], slots: [buried, slot], mountedIds: new Set(["upper"]) }),
    { kind: "slot", nodeId: "upper", slotId: "s-up" },
  );
});

test("框选默认完全落入，Alt 相交", () => {
  assert.equal(MARQUEE_DEFAULT_MODE, MARQUEE_MODE_CONTAIN);
  const marquee = { x: 0, y: 0, width: 50, height: 50 };
  const inside = { x: 10, y: 10, width: 20, height: 20 };
  const partial = { x: 40, y: 40, width: 20, height: 20 };
  assert.equal(marqueeHitsNode(marquee, inside, MARQUEE_MODE_CONTAIN), true);
  assert.equal(marqueeHitsNode(marquee, partial, MARQUEE_MODE_CONTAIN), false);
  assert.equal(marqueeHitsNode(marquee, partial, MARQUEE_MODE_INTERSECT), true);
  assert.equal(marqueeModeFromAlt(false), MARQUEE_MODE_CONTAIN);
  assert.equal(marqueeModeFromAlt(true), MARQUEE_MODE_INTERSECT);
});
