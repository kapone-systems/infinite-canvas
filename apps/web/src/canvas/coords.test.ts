/// <reference types="node" />
import assert from "node:assert/strict";
import { test } from "node:test";
import type { Camera } from "@canvas/schema";
import {
  DEFAULT_CAMERA,
  panByScreenDelta,
  screenToWorld,
  WHEEL_EXPONENT_CAP,
  WHEEL_PIXELS_PER_LINE,
  wheelFactor,
  worldLayerTransform,
  worldToScreen,
  zoomAtCenter,
  zoomAtPointer,
} from "./coords.ts";
import { WHEEL_ZOOM_FACTOR, ZOOM_MAX, ZOOM_MIN } from "./metrics.ts";

const VIEW = { width: 1280, height: 720 };

test("相机 x/y 为视口中心：世界点 (camera.x, camera.y) 映到屏幕中心", () => {
  const camera: Camera = { x: 40, y: -80, zoom: 1.25 };
  const screen = worldToScreen({ x: camera.x, y: camera.y }, camera, VIEW);
  assert.equal(screen.x, VIEW.width / 2);
  assert.equal(screen.y, VIEW.height / 2);
});

test("第 9.1 节公式：默认相机下世界原点在视口中心", () => {
  const screen = worldToScreen({ x: 0, y: 0 }, DEFAULT_CAMERA, VIEW);
  assert.equal(screen.x, 640);
  assert.equal(screen.y, 360);
});

test("worldToScreen 与 screenToWorld 互逆", () => {
  const camera: Camera = { x: -12, y: 96, zoom: 0.5 };
  const world = { x: 33, y: -7 };
  const screen = worldToScreen(world, camera, VIEW);
  const back = screenToWorld(screen, camera, VIEW);
  assert.ok(Math.abs(back.x - world.x) < 1e-9);
  assert.ok(Math.abs(back.y - world.y) < 1e-9);
});

test("平移按屏幕增量除以 zoom 移动中心，不改 zoom", () => {
  const camera: Camera = { x: 0, y: 0, zoom: 2 };
  const next = panByScreenDelta(camera, 40, -20);
  assert.equal(next.x, -20);
  assert.equal(next.y, 10);
  assert.equal(next.zoom, 2);
});

test("zoomAtCenter 只改 zoom、中心不变（非滚轮默认）", () => {
  const camera: Camera = { x: 10, y: 20, zoom: 1 };
  const inZoom = zoomAtCenter(camera, -100);
  assert.equal(inZoom.x, 10);
  assert.equal(inZoom.y, 20);
  assert.ok(inZoom.zoom > 1);
  const outZoom = zoomAtCenter(camera, 100);
  assert.ok(outZoom.zoom < 1);
});

test("zoomAtPointer：世界点钉在指针下", () => {
  const camera: Camera = { x: 40, y: -80, zoom: 1 };
  const pointer = { x: 200, y: 90 };
  const world = screenToWorld(pointer, camera, VIEW);
  const next = zoomAtPointer(camera, pointer, VIEW, -80);
  assert.ok(next.zoom > camera.zoom);
  assert.equal(next.zoom, camera.zoom * wheelFactor(-80, 0));
  assert.ok(next.zoom < camera.zoom * WHEEL_ZOOM_FACTOR);
  const screenAfter = worldToScreen(world, next, VIEW);
  assert.ok(Math.abs(screenAfter.x - pointer.x) < 1e-9);
  assert.ok(Math.abs(screenAfter.y - pointer.y) < 1e-9);
  const worldAfter = screenToWorld(pointer, next, VIEW);
  assert.ok(Math.abs(worldAfter.x - world.x) < 1e-9);
  assert.ok(Math.abs(worldAfter.y - world.y) < 1e-9);
});

test("zoomAtPointer：指针在视口中心时不平移相机", () => {
  const camera: Camera = { x: 10, y: 20, zoom: 1 };
  const pointer = { x: VIEW.width / 2, y: VIEW.height / 2 };
  const next = zoomAtPointer(camera, pointer, VIEW, -100);
  assert.ok(Math.abs(next.x - camera.x) < 1e-9);
  assert.ok(Math.abs(next.y - camera.y) < 1e-9);
  assert.equal(next.zoom, zoomAtCenter(camera, -100).zoom);
});

test("zoomAtPointer：到达上下限不再改相机", () => {
  const atMax: Camera = { x: 3, y: 5, zoom: ZOOM_MAX };
  const stillMax = zoomAtPointer(atMax, { x: 10, y: 10 }, VIEW, -100);
  assert.equal(stillMax.x, 3);
  assert.equal(stillMax.y, 5);
  assert.equal(stillMax.zoom, ZOOM_MAX);
  const atMin: Camera = { x: 3, y: 5, zoom: ZOOM_MIN };
  const stillMin = zoomAtPointer(atMin, { x: 10, y: 10 }, VIEW, 100);
  assert.equal(stillMin.zoom, ZOOM_MIN);
  assert.equal(stillMin.x, 3);
  assert.equal(stillMin.y, 5);
});

test("世界层 transform 用 translate3d+scale，不用 2D translate", () => {
  const css = worldLayerTransform({ x: 12, y: -4, zoom: 1.25 }, VIEW);
  assert.equal(
    css,
    "translate3d(640px, 360px, 0) scale(1.25) translate3d(-12px, 4px, 0)",
  );
  assert.equal(css.includes("translate(") && !css.includes("translate3d"), false);
  assert.ok(css.includes("translate3d"));
  assert.ok(!css.startsWith("translate("));
});

test("滚轮按 deltaMode 折算：一行大约 1.08，像素按比例缩小，单次指数封顶", () => {
  assert.equal(WHEEL_PIXELS_PER_LINE, 100);
  assert.equal(WHEEL_EXPONENT_CAP, 1);
  const camera: Camera = { x: 10, y: 20, zoom: 1 };
  assert.equal(wheelFactor(-1, 1), WHEEL_ZOOM_FACTOR);
  assert.ok(Math.abs(wheelFactor(1, 1) - 1 / WHEEL_ZOOM_FACTOR) < 1e-12);
  assert.equal(wheelFactor(-WHEEL_PIXELS_PER_LINE, 0), WHEEL_ZOOM_FACTOR);
  assert.equal(wheelFactor(WHEEL_PIXELS_PER_LINE, 0), 1 / WHEEL_ZOOM_FACTOR);
  const half = wheelFactor(-WHEEL_PIXELS_PER_LINE / 2, 0);
  assert.ok(half > 1);
  assert.ok(half < WHEEL_ZOOM_FACTOR);
  assert.equal(wheelFactor(-WHEEL_PIXELS_PER_LINE * 8, 0), WHEEL_ZOOM_FACTOR);
  assert.equal(wheelFactor(-3, 1), WHEEL_ZOOM_FACTOR);
  assert.equal(wheelFactor(-1, 2), WHEEL_ZOOM_FACTOR);
  const line = zoomAtPointer(camera, { x: 20, y: 20 }, VIEW, -1, 1);
  assert.equal(line.zoom, camera.zoom * WHEEL_ZOOM_FACTOR);
  const pixels = zoomAtPointer(camera, { x: 20, y: 20 }, VIEW, -WHEEL_PIXELS_PER_LINE, 0);
  assert.equal(pixels.zoom, line.zoom);
  const small = zoomAtPointer(camera, { x: 20, y: 20 }, VIEW, -10, 0);
  assert.ok(small.zoom > camera.zoom);
  assert.ok(small.zoom < pixels.zoom);
  const capped = zoomAtPointer(camera, { x: 20, y: 20 }, VIEW, -800, 0);
  assert.equal(capped.zoom, pixels.zoom);
  assert.equal(zoomAtCenter(camera, -WHEEL_PIXELS_PER_LINE).x, camera.x);
  assert.equal(zoomAtCenter(camera, -WHEEL_PIXELS_PER_LINE).zoom, WHEEL_ZOOM_FACTOR);
});
