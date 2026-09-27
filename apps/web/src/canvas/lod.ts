import type { Camera } from "@canvas/schema";
import type { Size } from "./coords.ts";
import {
  FAR_TITLE_MIN_SCREEN_PX,
  LOD_FAR,
  LOD_NEAR,
  MOUNT_CAP,
  MOUNT_OVERSCAN,
  THUMB_CAP,
} from "./metrics.ts";
import { rectsIntersect, type WorldRect } from "./spatialIndex.ts";

export type LodBand = "far" | "mid" | "near";

export type LodNode = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  hasThumb?: boolean;
};

export type LodPlan = {
  band: LodBand;
  /** 完整外壳，硬顶 MOUNT_CAP。 */
  mountedIds: string[];
  /** 视口内未挂载的色块。 */
  blockIds: string[];
  /** 视口内允许加载缩略图，硬顶 THUMB_CAP；再多边缘不进此列。 */
  thumbIds: string[];
};

export function lodBand(zoom: number): LodBand {
  if (zoom < LOD_FAR) {
    return "far";
  }
  if (zoom < LOD_NEAR) {
    return "mid";
  }
  return "near";
}

export function isFar(zoom: number): boolean {
  return zoom < LOD_FAR;
}

export function isNear(zoom: number): boolean {
  return zoom >= LOD_NEAR;
}

export function isMid(zoom: number): boolean {
  return !isFar(zoom) && !isNear(zoom);
}

/** 相机为视口中心：世界矩形覆盖 viewport（可再扩 overscan 个视口）。 */
export function worldViewRect(camera: Camera, viewport: Size, overscan = 0): WorldRect {
  const width = viewport.width / camera.zoom;
  const height = viewport.height / camera.zoom;
  const extraX = width * overscan;
  const extraY = height * overscan;
  return {
    x: camera.x - width / 2 - extraX,
    y: camera.y - height / 2 - extraY,
    width: width + extraX * 2,
    height: height + extraY * 2,
  };
}

export function nodeRect(node: LodNode): WorldRect {
  return { x: node.x, y: node.y, width: node.width, height: node.height };
}

function distSqToCamera(node: LodNode, camera: Camera): number {
  const cx = node.x + node.width / 2;
  const cy = node.y + node.height / 2;
  const dx = cx - camera.x;
  const dy = cy - camera.y;
  return dx * dx + dy * dy;
}

function byCenterThenId(camera: Camera, a: LodNode, b: LodNode): number {
  const da = distSqToCamera(a, camera);
  const db = distSqToCamera(b, camera);
  if (da !== db) {
    return da - db;
  }
  if (a.id < b.id) {
    return -1;
  }
  if (a.id > b.id) {
    return 1;
  }
  return 0;
}

export function farTitleVisible(worldWidth: number, zoom: number): boolean {
  return worldWidth * zoom >= FAR_TITLE_MIN_SCREEN_PX;
}

export function planLod(input: {
  camera: Camera;
  viewport: Size;
  nodes: readonly LodNode[];
}): LodPlan {
  const band = lodBand(input.camera.zoom);
  const view = worldViewRect(input.camera, input.viewport, 0);
  const visible = input.nodes.filter((node) => rectsIntersect(nodeRect(node), view));

  if (band !== "near") {
    return {
      band,
      mountedIds: [],
      blockIds: visible.map((node) => node.id),
      thumbIds: [],
    };
  }

  const overscan = worldViewRect(input.camera, input.viewport, MOUNT_OVERSCAN);
  const candidates = input.nodes
    .filter((node) => rectsIntersect(nodeRect(node), overscan))
    .sort((a, b) => byCenterThenId(input.camera, a, b));
  const mountedIds = candidates.slice(0, MOUNT_CAP).map((node) => node.id);
  const mountedSet = new Set(mountedIds);

  const blockIds: string[] = [];
  for (const node of visible) {
    if (!mountedSet.has(node.id)) {
      blockIds.push(node.id);
    }
  }

  const thumbCandidates = visible
    .filter((node) => mountedSet.has(node.id) && node.hasThumb === true)
    .sort((a, b) => byCenterThenId(input.camera, a, b));
  const thumbIds = thumbCandidates.slice(0, THUMB_CAP).map((node) => node.id);
  const thumbSet = new Set(thumbIds);
  for (const node of thumbCandidates) {
    if (!thumbSet.has(node.id)) {
      blockIds.push(node.id);
      const idx = mountedIds.indexOf(node.id);
      if (idx >= 0) {
        mountedIds.splice(idx, 1);
        mountedSet.delete(node.id);
      }
    }
  }

  return { band, mountedIds, blockIds, thumbIds };
}

/** zoom < 0.8 不挂外壳；顶 120 只约束近景。 */
export function pickMountedIds(input: {
  camera: Camera;
  viewport: Size;
  nodes: readonly LodNode[];
}): string[] {
  if (input.camera.zoom < LOD_NEAR) {
    return [];
  }
  return planLod(input).mountedIds;
}
