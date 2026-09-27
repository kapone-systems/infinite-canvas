import type { ProjectEdge, ProjectNode, Slot } from "@canvas/schema";
import { slotTitle } from "@canvas/schema";

/** 槽的显示名加上游节点标题。没有类名。 */
export function slotSourceLine(
  slot: Slot,
  slots: readonly Slot[],
  nodes: Record<string, ProjectNode>,
  edges: Record<string, ProjectEdge>,
): string | null {
  if (slot.edgeId === null) {
    return null;
  }
  const edge = edges[slot.edgeId];
  if (edge === undefined) {
    return null;
  }
  const role = slotTitle(slots, slot);
  const upstream = nodes[edge.sourceNodeId];
  if (upstream === undefined) {
    return role;
  }
  return `${role} · ${upstream.title}`;
}

/** 拖出素材：显示来源节点标题。 */
export function provenanceSourceLine(
  node: ProjectNode,
  nodes: Record<string, ProjectNode>,
): string | null {
  const sourceId = node.provenance?.sourceNodeId;
  if (sourceId === undefined || sourceId.length === 0) {
    return null;
  }
  const source = nodes[sourceId];
  if (source === undefined) {
    return null;
  }
  return source.title;
}
