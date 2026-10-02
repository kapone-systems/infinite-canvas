/// <reference types="node" />
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import type { Camera } from "@canvas/schema";
import { zoomAtCenter, zoomAtPointer } from "./coords.ts";
import {
  applyWheelZoom,
  autoPanScreenDelta,
  axisLockedDelta,
  canDragNodeBody,
  decideChipDrop,
  decideExtractCommit,
  decideReorderCommit,
  EXTRACT_MISSED_SLOT,
  extractDropFeedback,
  exceededThreshold,
  readSlotHandleTarget,
  readVariantStripNodeId,
  resolveMoveDelta,
  shouldAdoptStoreCamera,
  shouldStartTextEdit,
  wheelAction,
  wheelShouldZoom,
  type DomLike,
} from "./gestures.ts";
import { edgePaintStyle } from "./EdgeCanvas.ts";
import { CONNECT_BOUNCE_MS, EXTRACT_LEAVE_PX, POINTER_THRESHOLD_PX, REORDER_SHIFT_MS, SELECTED_STROKE } from "./metrics.ts";

const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "gestures.ts"), "utf8");

test("滚轮走 zoomAtPointer，源码不把 zoomAtCenter 当默认", () => {
  assert.equal(src.includes("zoomAtPointer"), true);
  assert.equal(src.includes("applyWheelZoom"), true);
  const wheelCall = src.includes("zoomAtCenter(");
  assert.equal(wheelCall, false);
  const camera: Camera = { x: 40, y: -80, zoom: 1 };
  const viewport = { width: 1280, height: 720 };
  const pointer = { x: 200, y: 90 };
  const next = applyWheelZoom(camera, pointer, viewport, -80);
  const center = zoomAtCenter(camera, -80);
  assert.notEqual(next.x, center.x);
  assert.equal(next.zoom, zoomAtPointer(camera, pointer, viewport, -80).zoom);
});

test("组字中与可编辑目标不缩放，查看大图打开时也不缩放", () => {
  assert.equal(wheelShouldZoom({ composing: true, editable: false, viewerOpen: false }), false);
  assert.equal(wheelShouldZoom({ composing: false, editable: true, viewerOpen: false }), false);
  assert.equal(wheelShouldZoom({ composing: false, editable: false, viewerOpen: true }), false);
  const camera = { x: 10, y: 20, zoom: 1 };
  const zoomed = wheelShouldZoom({ composing: false, editable: false, viewerOpen: false })
    ? applyWheelZoom(camera, { x: 40, y: 40 }, { width: 800, height: 600 }, -100)
    : camera;
  assert.notEqual(zoomed.zoom, camera.zoom);
  const blocked = wheelShouldZoom({ composing: false, editable: false, viewerOpen: true })
    ? applyWheelZoom(camera, { x: 40, y: 40 }, { width: 800, height: 600 }, -100)
    : camera;
  assert.equal(blocked.x, camera.x);
  assert.equal(blocked.y, camera.y);
  assert.equal(blocked.zoom, camera.zoom);
});

test("按下阈值 4 屏幕像素", () => {
  assert.equal(POINTER_THRESHOLD_PX, 4);
  assert.equal(exceededThreshold(3, 0), false);
  assert.equal(exceededThreshold(4, 0), true);
  assert.equal(exceededThreshold(0, 4), true);
});

test("同时只有一个手势：已有 active 时忽略第二指针（源码）", () => {
  assert.equal(src.includes("if (active !== null)"), true);
  assert.equal(src.includes('kind: "pan"'), true);
  assert.equal(src.includes('active.kind = "move"'), true);
  assert.equal(src.includes('kind: "connect"'), true);
  assert.equal(src.includes('active.kind = "marquee"'), true);
});

test("手势空闲时采用 store 相机，进行中保留 live", () => {
  assert.equal(shouldAdoptStoreCamera(false), true);
  assert.equal(shouldAdoptStoreCamera(true), false);
  assert.equal(src.includes("syncCamera"), true);
});

test("抽出必须先 pending：未过阈值不升 extract；离开 EXTRACT_LEAVE_PX 或 Alt 才升", () => {
  assert.equal(EXTRACT_LEAVE_PX, 8);
  assert.equal(src.includes("EXTRACT_LEAVE_PX"), true);
  assert.equal(src.includes("extractFrom"), true);
  assert.equal(src.includes('active.kind = "extract"'), true);
  assert.equal(src.includes('active.kind = "reorder-slot"'), true);
  const downStart = src.indexOf("const onPointerDown");
  const downEnd = src.indexOf("const flushMove");
  const down = src.slice(downStart, downEnd);
  assert.equal(down.includes('= "extract"'), false);
  assert.equal(down.includes('kind: "pending"'), true);
  assert.equal(src.includes("store.connect("), true);
  assert.equal(src.includes("connectDemo"), false);
  const endStart = src.indexOf("const endGesture");
  const end = src.slice(endStart);
  assert.equal(end.includes('current.kind === "extract"'), true);
  assert.equal(end.includes('current.kind === "reorder-slot"'), true);
  assert.equal(end.includes("setGestureActive(false)"), true);
  assert.equal(end.includes("decideExtractCommit"), true);
  assert.equal(end.includes("extractVariantToBlank"), true);
  assert.equal(src.includes("slotPortWorld(fromNode, active.connectFrom.slotOrder"), true);
});

test("拖回源变体条不抽出；落到空白才 +1", () => {
  assert.equal(CONNECT_BOUNCE_MS, 180);
  assert.deepEqual(
    decideExtractCommit({ dropOnSourceStrip: true, hitKind: "empty" }),
    { action: "none" },
  );
  assert.deepEqual(
    decideExtractCommit({ dropOnSourceStrip: true, hitKind: "slot", hitNodeId: "g", hitSlotId: "s" }),
    { action: "none" },
  );
  assert.deepEqual(
    decideExtractCommit({ dropOnSourceStrip: false, hitKind: "empty" }),
    { action: "blank" },
  );
  assert.deepEqual(
    decideExtractCommit({
      dropOnSourceStrip: false,
      hitKind: "slot",
      hitNodeId: "g",
      hitSlotId: "s",
    }),
    { action: "slot", targetNodeId: "g", targetSlotId: "s" },
  );
  assert.deepEqual(
    decideExtractCommit({ dropOnSourceStrip: false, hitKind: "near-node" }),
    { action: "none" },
  );
});

test("move 松手即使位移 0 也 setGestureActive(false) 以 flush patch", () => {
  const start = src.indexOf('if (current.kind === "move")');
  assert.equal(start >= 0, true);
  const block = src.slice(start, start + 1200);
  assert.equal(block.includes("store.setGestureActive(false)"), true);
  const flushAt = block.indexOf("store.setGestureActive(false)");
  const moveAt = block.indexOf("store.moveNodes");
  assert.equal(flushAt >= 0, true);
  assert.equal(moveAt > flushAt, true);
  assert.equal(src.includes('store.setGestureActive(true, "move")'), true);
  assert.equal(src.includes('store.setGestureActive(true, "pan")'), true);
});

test("查看大图不改画布 onWheel，查看器在滚轮监听之外并自己吃掉滚轮", () => {
  const wheelStart = src.indexOf("const onWheel");
  const wheelEnd = src.indexOf('el.addEventListener("wheel"');
  assert.equal(wheelStart >= 0 && wheelEnd > wheelStart, true);
  const wheel = src.slice(wheelStart, wheelEnd);
  assert.equal(wheel.includes("applyWheelZoom"), true);
  assert.equal(wheel.includes("image-viewer"), false);
  assert.equal(wheel.includes("ImageViewer"), false);
  const app = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../App.tsx"), "utf8");
  const viewer = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "ImageViewer.tsx"), "utf8");
  const hostEnd = app.indexOf("canvas-host-end");
  const viewerUse = app.indexOf("<ImageViewer");
  assert.equal(hostEnd >= 0 && viewerUse > hostEnd, true);
  assert.equal(viewer.includes("consumeViewerWheel"), true);
  const wheelFn = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "viewerWheel.ts"), "utf8");
  assert.equal(wheelFn.includes("preventDefault"), true);
  assert.equal(wheelFn.includes("stopPropagation"), true);
  assert.equal(viewer.includes('purpose: "thumb"') || viewer.includes("<ThumbImage"), true);
  assert.equal(viewer.includes("setCamera"), false);
  assert.equal(viewer.includes("relativePath"), false);
  const close = app.slice(app.indexOf("onClose={() => {"), app.indexOf("onClose={() => {") + 120);
  assert.equal(close.includes("setViewerThumb(null)"), true);
  assert.equal(close.includes("setCamera"), false);
});

function domNode(
  attrs: Record<string, string>,
  parent: DomLike | null,
  selfSelectors: readonly string[],
): DomLike {
  const node: DomLike = {
    getAttribute(name: string): string | null {
      return Object.hasOwn(attrs, name) ? attrs[name]! : null;
    },
    closest(selector: string): DomLike | null {
      const parts = selector.split(",").map((part) => part.trim());
      if (selfSelectors.some((item) => parts.includes(item))) {
        return node;
      }
      return parent?.closest(selector) ?? null;
    },
  };
  return node;
}

test("重排松手认握把和 buildHit，不认槽行或标签，也不靠 event.target", () => {
  const node = domNode({ "data-node-id": "n1" }, null, ["[data-node-id]"]);
  const handle = domNode(
    { "data-slot-handle": "slot-b", "data-slot-id": "ignored" },
    node,
    ["[data-slot-handle]"],
  );
  const fallback = domNode({ "data-slot-handle": "", "data-slot-id": "slot-c" }, node, ["[data-slot-handle]"]);
  const row = domNode({ "data-slot-id": "slot-b" }, node, ["[data-slot-id]"]);
  const label = domNode({}, row, []);
  assert.deepEqual(readSlotHandleTarget(handle), { nodeId: "n1", slotId: "slot-b" });
  assert.deepEqual(readSlotHandleTarget(fallback), { nodeId: "n1", slotId: "slot-c" });
  assert.equal(readSlotHandleTarget(row), null);
  assert.equal(readSlotHandleTarget(label), null);
  assert.equal(readSlotHandleTarget(null), null);

  const sameRole = {
    fromNodeId: "n1",
    fromSlotId: "slot-a",
    handleNodeId: "n1",
    handleSlotId: "slot-b",
    hitKind: "slot",
    hitNodeId: "n1",
    hitSlotId: "slot-b",
    fromRole: "reference_image",
    toRole: "reference_image",
  };
  assert.equal(decideReorderCommit(sameRole), true);
  assert.equal(decideReorderCommit({ ...sameRole, handleSlotId: "slot-a", hitSlotId: "slot-a" }), false);
  assert.equal(
    decideReorderCommit({ ...sameRole, handleNodeId: "n2", hitNodeId: "n2" }),
    false,
  );
  assert.equal(decideReorderCommit({ ...sameRole, handleNodeId: null, handleSlotId: null }), false);
  assert.equal(decideReorderCommit({ ...sameRole, toRole: "prompt" }), false);
  assert.equal(decideReorderCommit({ ...sameRole, fromRole: undefined }), false);
  assert.equal(
    decideReorderCommit({ ...sameRole, hitKind: "near-node", hitNodeId: null, hitSlotId: null }),
    false,
  );
  assert.equal(decideReorderCommit({ ...sameRole, hitSlotId: "slot-c" }), false);

  const end = src.slice(src.indexOf("const endGesture"));
  const reorder = end.slice(
    end.indexOf('current.kind === "reorder-slot"'),
    end.indexOf('current.kind === "pending"'),
  );
  const extract = end.slice(
    end.indexOf('current.kind === "extract"'),
    end.indexOf('current.kind === "reorder-slot"'),
  );
  assert.equal(reorder.includes("event.target"), false);
  assert.equal(extract.includes("event.target"), false);
  assert.equal(reorder.includes("elementUnderPointer"), true);
  assert.equal(extract.includes("elementUnderPointer"), true);
  assert.equal(reorder.includes("buildHit"), true);
  assert.equal(extract.includes("buildHit"), true);
  assert.equal(reorder.includes("readSlotHandleTarget"), true);
  assert.equal(reorder.includes("decideReorderCommit"), true);
  assert.equal(reorder.includes("reorderSlots"), true);
  assert.equal(extract.includes("readVariantStripNodeId"), true);
  assert.equal(extract.includes("decideExtractCommit"), true);
  assert.equal(extract.includes("extractVariantToSlot"), true);
  assert.equal(extract.includes("extractVariantToBlank"), true);
  assert.equal(extract.includes("targetNodeId !== extract.nodeId"), true);
  assert.equal(extract.includes("extractDropFeedback"), true);
  assert.equal(src.includes("document.elementFromPoint"), true);
  assert.equal(src.includes("setPointerCapture"), true);
  assert.equal(REORDER_SHIFT_MS, 120);
  assert.equal(src.includes("(prefers-reduced-motion: reduce)"), true);
  assert.equal(src.includes("translate3d(0,"), true);
});

test("抽出落回源条或节点身上不建节点；别的节点的槽和空白才提交", () => {
  const node = domNode({ "data-node-id": "src" }, null, ["[data-node-id]"]);
  const strip = domNode({ "data-variant-strip": "src" }, node, ["[data-variant-strip]", ".variant-strip"]);
  const otherNode = domNode({ "data-node-id": "other" }, null, ["[data-node-id]"]);
  const otherStrip = domNode({}, otherNode, [".variant-strip"]);
  assert.equal(readVariantStripNodeId(strip), "src");
  assert.equal(readVariantStripNodeId(otherStrip), "other");
  assert.equal(readVariantStripNodeId(node), null);
  assert.equal(EXTRACT_MISSED_SLOT, "没有落到槽上，已取消");
  assert.equal(
    extractDropFeedback({ commit: { action: "none" }, dropOnSourceStrip: true, hitKind: "slot" }),
    EXTRACT_MISSED_SLOT,
  );
  assert.equal(
    extractDropFeedback({ commit: { action: "none" }, dropOnSourceStrip: false, hitKind: "near-node" }),
    EXTRACT_MISSED_SLOT,
  );
  assert.equal(
    extractDropFeedback({ commit: { action: "none" }, dropOnSourceStrip: false, hitKind: "far-block" }),
    EXTRACT_MISSED_SLOT,
  );
  assert.equal(
    extractDropFeedback({ commit: { action: "none" }, dropOnSourceStrip: false, hitKind: "edge" }),
    null,
  );
  assert.equal(
    extractDropFeedback({ commit: { action: "none" }, dropOnSourceStrip: false, hitKind: "slot-gap" }),
    null,
  );
  assert.equal(
    extractDropFeedback({ commit: { action: "none" }, dropOnSourceStrip: false, hitKind: "output" }),
    null,
  );
  assert.equal(
    extractDropFeedback({
      commit: { action: "slot", targetNodeId: "g", targetSlotId: "s" },
      dropOnSourceStrip: false,
      hitKind: "slot",
    }),
    null,
  );
  assert.equal(
    extractDropFeedback({ commit: { action: "blank" }, dropOnSourceStrip: false, hitKind: "empty" }),
    null,
  );
  assert.deepEqual(
    decideExtractCommit({ dropOnSourceStrip: false, hitKind: "edge" }),
    { action: "none" },
  );
  assert.deepEqual(
    decideExtractCommit({ dropOnSourceStrip: false, hitKind: "slot-gap" }),
    { action: "none" },
  );
  assert.deepEqual(
    decideExtractCommit({ dropOnSourceStrip: false, hitKind: "output" }),
    { action: "none" },
  );
});

test("单击边只选边；Shift 加入或移出；从边上拖仍是框选", () => {
  const pending = src.slice(src.indexOf('if (current.kind === "pending")'));
  assert.equal(pending.includes('current.hit.kind === "edge"'), true);
  assert.equal(pending.includes("store.select([], [edgeId])"), true);
  assert.equal(pending.includes("selectedEdgeIds"), true);
  assert.equal(src.includes('active.hit.kind === "empty" || active.hit.kind === "edge"'), true);
  const marquee = src.slice(src.indexOf('if (current.kind === "marquee")'), src.indexOf('if (current.kind === "connect"'));
  assert.equal(marquee.includes("marqueeSelect"), true);
  assert.equal(marquee.includes("selectedEdgeIds"), false);
  const selected = edgePaintStyle({ selected: true, straight: false, roleStroke: "#8ab4ff" });
  const plain = edgePaintStyle({ selected: false, straight: true, roleStroke: "#8ab4ff" });
  assert.equal(selected.stroke, SELECTED_STROKE);
  assert.equal(selected.width, 3);
  assert.ok(selected.width > plain.width);
  assert.notEqual(selected.stroke, plain.stroke);
  const edgeSrc = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "EdgeCanvas.ts"), "utf8");
  assert.equal(edgeSrc.includes("selectedEdgeIds"), true);
  assert.equal(edgeSrc.includes("edgePaintStyle"), true);
});

test("滚轮：文本框和溢出变体条交给浏览器；其余先 preventDefault；不改成平移", () => {
  assert.equal(
    wheelAction({
      inTextField: true,
      inVariantStrip: false,
      stripOverflows: false,
      composing: false,
      editable: true,
      viewerOpen: false,
    }),
    "yield",
  );
  assert.equal(
    wheelAction({
      inTextField: false,
      inVariantStrip: true,
      stripOverflows: true,
      composing: false,
      editable: true,
      viewerOpen: false,
    }),
    "yield",
  );
  assert.equal(
    wheelAction({
      inTextField: false,
      inVariantStrip: true,
      stripOverflows: false,
      composing: false,
      editable: true,
      viewerOpen: false,
    }),
    "zoom",
  );
  assert.equal(
    wheelAction({
      inTextField: false,
      inVariantStrip: false,
      stripOverflows: false,
      composing: true,
      editable: false,
      viewerOpen: false,
    }),
    "ignore",
  );
  assert.equal(
    wheelAction({
      inTextField: false,
      inVariantStrip: false,
      stripOverflows: false,
      composing: false,
      editable: false,
      viewerOpen: true,
    }),
    "ignore",
  );
  assert.equal(
    wheelAction({
      inTextField: false,
      inVariantStrip: false,
      stripOverflows: false,
      composing: false,
      editable: true,
      viewerOpen: false,
    }),
    "ignore",
  );
  assert.equal(
    wheelAction({
      inTextField: false,
      inVariantStrip: false,
      stripOverflows: false,
      composing: false,
      editable: false,
      viewerOpen: false,
    }),
    "zoom",
  );
  const wheelStart = src.indexOf("const onWheel");
  const wheelEnd = src.indexOf('el.addEventListener("wheel"');
  const wheel = src.slice(wheelStart, wheelEnd);
  const yieldAt = wheel.indexOf('action === "yield"');
  const preventAt = wheel.indexOf("preventDefault");
  assert.ok(yieldAt >= 0 && preventAt > yieldAt);
  assert.equal(wheel.includes("event.deltaMode"), true);
  assert.equal(wheel.includes("panByScreenDelta"), false);
  assert.equal(wheel.includes("isTextEditing"), false);
  assert.equal(wheel.includes("zoomAtCenter"), false);
  assert.equal(wheel.includes("applyWheelZoom"), true);
});

test("主键在变体和握把之前就因可编辑目标返回；编辑中点到外面仍继续", () => {
  const down = src.slice(src.indexOf("const onPointerDown"), src.indexOf("const flushMove"));
  const middle = down.indexOf("event.button === 1");
  const add = down.indexOf("data-add-slot");
  const firstEditable = down.indexOf("isEditableTarget(event.target)");
  const editable = down.indexOf("isEditableTarget(event.target)", firstEditable + 1);
  const variant = down.indexOf("data-variant-id");
  const handle = down.indexOf("data-slot-handle");
  assert.ok(middle >= 0 && middle < add);
  assert.ok(add >= 0 && editable > add && editable < variant && editable < handle);
  assert.equal(down.includes("options.isTextEditing()"), false);
  assert.equal(down.includes("if (active !== null)"), true);
  const promote = src.slice(src.indexOf("if (active.extractFrom !== null)"), src.indexOf('active.kind = "reorder-slot"'));
  assert.equal(promote.includes("EXTRACT_LEAVE_PX"), true);
  const extractAt = promote.indexOf('active.kind = "extract"');
  const scrollAt = promote.indexOf("scrollLeft");
  assert.ok(extractAt >= 0 && scrollAt > extractAt);
  assert.equal(promote.includes("scrolled = true"), true);
  assert.equal(src.includes("!current.extractFrom.scrolled"), true);
});

test("文本正文不拖；标题、非文本和远景可以拖；双击预览才编辑", () => {
  assert.equal(canDragNodeBody({ hitKind: "near-node", nodeKind: "text", inHeader: false }), false);
  assert.equal(canDragNodeBody({ hitKind: "near-node", nodeKind: "text", inHeader: true }), true);
  assert.equal(canDragNodeBody({ hitKind: "near-node", nodeKind: "image", inHeader: false }), true);
  assert.equal(canDragNodeBody({ hitKind: "far-block", nodeKind: "text", inHeader: false }), true);
  assert.equal(canDragNodeBody({ hitKind: "group", inHeader: false }), true);
  assert.equal(canDragNodeBody({ hitKind: "slot", nodeKind: "generation", inHeader: false }), false);
  assert.equal(
    shouldStartTextEdit({ detail: 2, hitKind: "near-node", nodeKind: "text", inHeader: false }),
    true,
  );
  assert.equal(
    shouldStartTextEdit({ detail: 2, hitKind: "near-node", nodeKind: "text", inHeader: true }),
    false,
  );
  assert.equal(
    shouldStartTextEdit({ detail: 1, hitKind: "near-node", nodeKind: "text", inHeader: false }),
    false,
  );
  assert.equal(
    shouldStartTextEdit({ detail: 2, hitKind: "far-block", nodeKind: "text", inHeader: false }),
    false,
  );
});

test("Shift 先锁轴再吸附；边缘自动平移越靠边越快", () => {
  assert.deepEqual(axisLockedDelta(3, 1, false), { dx: 3, dy: 1 });
  assert.deepEqual(axisLockedDelta(5, 2, true), { dx: 5, dy: 0 });
  assert.deepEqual(axisLockedDelta(2, 5, true), { dx: 0, dy: 5 });
  assert.deepEqual(axisLockedDelta(4, 4, true), { dx: 4, dy: 0 });
  const snapped = resolveMoveDelta({
    dx: 8,
    dy: 1,
    shift: true,
    zoom: 1,
    moving: [{ id: "a", x: 0, y: 0, width: 100, height: 40 }],
    others: [{ id: "b", x: 106, y: 200, width: 20, height: 20 }],
  });
  assert.equal(snapped.dy, 0);
  assert.equal(snapped.dx, 6);
  assert.deepEqual(snapped.guides, [{ axis: "x", world: 106 }]);
  const view = { width: 200, height: 100 };
  assert.deepEqual(autoPanScreenDelta({ x: 0, y: 50 }, view), { x: 24, y: 0 });
  assert.deepEqual(autoPanScreenDelta({ x: 12, y: 50 }, view), { x: 12, y: 0 });
  assert.deepEqual(autoPanScreenDelta({ x: 24, y: 50 }, view), { x: 0, y: 0 });
  assert.deepEqual(autoPanScreenDelta({ x: 200, y: 0 }, view), { x: -24, y: 24 });
  assert.equal(src.includes("stageAltDuplicate"), true);
  assert.equal(src.includes("duplicateSelection"), false);
  assert.equal(src.includes("commitAltMove"), true);
  assert.equal(src.includes("applyGuides"), true);
});

test("芯片拖走：空白才断开；另一个槽才挪边；槽体拉线不改成断开", () => {
  assert.equal(
    decideChipDrop({ fromNodeId: "n", fromSlotId: "a", hitKind: "empty" }),
    "disconnect",
  );
  assert.equal(
    decideChipDrop({
      fromNodeId: "n",
      fromSlotId: "a",
      hitKind: "slot",
      hitNodeId: "n",
      hitSlotId: "a",
    }),
    "none",
  );
  assert.equal(
    decideChipDrop({
      fromNodeId: "n",
      fromSlotId: "a",
      hitKind: "slot",
      hitNodeId: "m",
      hitSlotId: "b",
    }),
    "move",
  );
  assert.equal(
    decideChipDrop({ fromNodeId: "n", fromSlotId: "a", hitKind: "near-node", hitNodeId: "m" }),
    "none",
  );
  const down = src.slice(src.indexOf("const onPointerDown"), src.indexOf("const flushMove"));
  const chipAt = down.indexOf("data-slot-chip");
  const hitAt = down.indexOf("const hit = buildHit");
  assert.ok(chipAt > 0 && hitAt > chipAt);
  const connectAt = src.indexOf('if (current.kind === "connect" && current.connectFrom !== null)');
  const connect = src.slice(connectAt, connectAt + 2800);
  const chipBranch = connect.indexOf("current.chipFrom !== null");
  const connectCall = connect.indexOf("store.connect(");
  assert.ok(chipBranch >= 0 && connectCall > chipBranch);
  assert.equal(connect.slice(0, chipBranch).includes("disconnectSlot"), false);
  assert.equal(connect.includes("要连到槽上，已取消"), false);
});



