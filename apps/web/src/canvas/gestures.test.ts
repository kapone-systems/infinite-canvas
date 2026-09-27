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
  decideExtractCommit,
  exceededThreshold,
  shouldAdoptStoreCamera,
  wheelShouldZoom,
} from "./gestures.ts";
import { CONNECT_BOUNCE_MS, EXTRACT_LEAVE_PX, POINTER_THRESHOLD_PX } from "./metrics.ts";

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
  const block = src.slice(start, start + 500);
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
