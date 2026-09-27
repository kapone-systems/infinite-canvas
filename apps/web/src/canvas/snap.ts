import { SNAP } from "./metrics.ts";

export type SnapRect = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

function nearest(value: number, candidates: number[], threshold: number): number | null {
  let best: number | null = null;
  let bestDist = threshold;
  for (const candidate of candidates) {
    const dist = Math.abs(value - candidate);
    if (dist <= bestDist) {
      best = candidate;
      bestDist = dist;
    }
  }
  return best;
}

/**
 * 与其他节点的边或中心线距离 ≤ SNAP 屏幕像素时吸附。
 * 被拖节点彼此之间不互相吸附。位移写进 moveNodes。
 */
export function snapWorldDelta(
  moving: readonly SnapRect[],
  others: readonly SnapRect[],
  dx: number,
  dy: number,
  zoom: number,
  thresholdScreen = SNAP,
): { dx: number; dy: number } {
  if (moving.length === 0 || others.length === 0) {
    return { dx, dy };
  }
  const thresh = thresholdScreen / Math.max(zoom, 1e-6);
  const otherX: number[] = [];
  const otherY: number[] = [];
  for (const node of others) {
    otherX.push(node.x, node.x + node.width / 2, node.x + node.width);
    otherY.push(node.y, node.y + node.height / 2, node.y + node.height);
  }
  let snapDx = dx;
  let snapDy = dy;
  let bestX = thresh;
  let bestY = thresh;
  for (const node of moving) {
    const nx = node.x + dx;
    const ny = node.y + dy;
    const xs = [nx, nx + node.width / 2, nx + node.width];
    const ys = [ny, ny + node.height / 2, ny + node.height];
    for (const x of xs) {
      const hit = nearest(x, otherX, thresh);
      if (hit !== null) {
        const adj = hit - x;
        const dist = Math.abs(adj);
        if (dist < bestX) {
          bestX = dist;
          snapDx = dx + adj;
        }
      }
    }
    for (const y of ys) {
      const hit = nearest(y, otherY, thresh);
      if (hit !== null) {
        const adj = hit - y;
        const dist = Math.abs(adj);
        if (dist < bestY) {
          bestY = dist;
          snapDy = dy + adj;
        }
      }
    }
  }
  return { dx: snapDx, dy: snapDy };
}
