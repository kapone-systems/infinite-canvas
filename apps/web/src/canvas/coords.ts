import type { Camera } from "@canvas/schema";
import { WHEEL_ZOOM_FACTOR, ZOOM_MAX, ZOOM_MIN } from "./metrics.ts";

export type Point = { x: number; y: number };
export type Size = { width: number; height: number };

export const DEFAULT_CAMERA: Camera = { x: 0, y: 0, zoom: 1 };

export function clampZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) {
    return 1;
  }
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom));
}

export function normalizeCamera(camera: Camera): Camera {
  return {
    x: Number.isFinite(camera.x) ? camera.x : 0,
    y: Number.isFinite(camera.y) ? camera.y : 0,
    zoom: clampZoom(camera.zoom),
  };
}

/**
 * 方案第 9.1 节：
 * screenX = (worldX - camera.x) * zoom + viewportWidth / 2
 * screenY = (worldY - camera.y) * zoom + viewportHeight / 2
 * camera.x/y 是视口中心对应的世界坐标。
 */
export function worldToScreen(world: Point, camera: Camera, viewport: Size): Point {
  return {
    x: (world.x - camera.x) * camera.zoom + viewport.width / 2,
    y: (world.y - camera.y) * camera.zoom + viewport.height / 2,
  };
}

export function screenToWorld(screen: Point, camera: Camera, viewport: Size): Point {
  return {
    x: (screen.x - viewport.width / 2) / camera.zoom + camera.x,
    y: (screen.y - viewport.height / 2) / camera.zoom + camera.y,
  };
}

/** CSS 像素换成世界长度：热区、边容差、槽扩展都走这一份。 */
export function cssToWorld(cssPx: number, zoom: number): number {
  return cssPx / zoom;
}

/**
 * 热路径世界层：translate3d + scale。禁止 2D translate（会打穿合成层）。
 * transform-origin: 0 0。
 */
export function worldLayerTransform(camera: Camera, viewport: Size): string {
  return `translate3d(${viewport.width / 2}px, ${viewport.height / 2}px, 0) scale(${camera.zoom}) translate3d(${-camera.x}px, ${-camera.y}px, 0)`;
}

/** 抓住画布拖向 (dx, dy) 屏幕像素：相向移动视口中心。 */
export function panByScreenDelta(camera: Camera, dx: number, dy: number): Camera {
  return {
    x: camera.x - dx / camera.zoom,
    y: camera.y - dy / camera.zoom,
    zoom: camera.zoom,
  };
}

/** 像素模式里，大约这么多像素算鼠标一行。 */
export const WHEEL_PIXELS_PER_LINE = 100;
/** 单次滚轮事件的指数绝对值上限。一行大约仍是 WHEEL_ZOOM_FACTOR。 */
export const WHEEL_EXPONENT_CAP = 1;

/**
 * 负 deltaY 放大。行模式（deltaMode 1）的 1 行、像素模式大约 100 像素，都是 WHEEL_ZOOM_FACTOR。
 * 像素按比例缩小；单次指数不超过 WHEEL_EXPONENT_CAP。
 */
export function wheelFactor(deltaY: number, deltaMode = 0): number {
  const notches = wheelNotches(deltaY, deltaMode);
  if (notches === 0) {
    return 1;
  }
  const capped = Math.sign(notches) * Math.min(Math.abs(notches), WHEEL_EXPONENT_CAP);
  return Math.pow(WHEEL_ZOOM_FACTOR, -capped);
}

function wheelNotches(deltaY: number, deltaMode: number): number {
  if (!Number.isFinite(deltaY) || deltaY === 0) {
    return 0;
  }
  if (deltaMode === 1) {
    return deltaY;
  }
  if (deltaMode === 2) {
    return deltaY * (WHEEL_EXPONENT_CAP + 1);
  }
  return deltaY / WHEEL_PIXELS_PER_LINE;
}

/**
 * 滚轮默认：锚在指针。该世界点缩放前后落在同一屏幕位置（P7）。
 * 到达 ZOOM_MIN / ZOOM_MAX 时不改相机。
 */
export function zoomAtPointer(
  camera: Camera,
  pointer: Point,
  viewport: Size,
  deltaY: number,
  deltaMode = 0,
): Camera {
  const world = screenToWorld(pointer, camera, viewport);
  const zoom = clampZoom(camera.zoom * wheelFactor(deltaY, deltaMode));
  if (zoom === camera.zoom) {
    return camera;
  }
  return {
    x: world.x - (pointer.x - viewport.width / 2) / zoom,
    y: world.y - (pointer.y - viewport.height / 2) / zoom,
    zoom,
  };
}

/** 仅 Ctrl+0 一类「中心不变」路径使用。滚轮不要走这里。 */
export function zoomAtCenter(camera: Camera, deltaY: number, deltaMode = 0): Camera {
  return {
    x: camera.x,
    y: camera.y,
    zoom: clampZoom(camera.zoom * wheelFactor(deltaY, deltaMode)),
  };
}

export function camerasEqual(a: Camera, b: Camera): boolean {
  return a.x === b.x && a.y === b.y && a.zoom === b.zoom;
}

/** 节点外壳热路径：translate3d，不要 left/top。 */
export function nodeTransform(x: number, y: number): string {
  return `translate3d(${x}px, ${y}px, 0)`;
}
