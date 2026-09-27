/**
 * 方案第 5.4 节：媒体槽读源节点当前 output。过期不把图藏起来。
 */

import type { MediaRef, ProjectEdge, ProjectNode, Slot } from "./types.ts";

export function resolveSlotMedia(
  slot: Slot,
  nodes: Record<string, ProjectNode>,
  edges: Record<string, ProjectEdge>,
): MediaRef | null {
  if (slot.edgeId === null) {
    return null;
  }
  const edge = edges[slot.edgeId];
  if (edge === undefined) {
    return null;
  }
  const source = nodes[edge.sourceNodeId];
  if (source === undefined) {
    return null;
  }
  return source.output ?? null;
}
