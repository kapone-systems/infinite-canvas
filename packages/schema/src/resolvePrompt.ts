/**
 * 方案第 5.4 节：提示词只有一个真相。
 * 有 prompt 边：用源 text，空字符串也用空字符串，不回落草稿。
 * 无边：用 promptDraft。
 */

import type { ProjectEdge, ProjectNode } from "./types.ts";

function sourceText(source: ProjectNode | undefined): string {
  if (source === undefined) {
    return "";
  }
  if (source.kind === "text") {
    return source.text ?? "";
  }
  if (source.outputKind === "text") {
    return source.outputText ?? "";
  }
  return source.text ?? "";
}

export function resolvePrompt(
  node: ProjectNode,
  nodes: Record<string, ProjectNode>,
  edges: Record<string, ProjectEdge>,
): string {
  const promptSlots = (node.slots ?? [])
    .filter((slot) => slot.role === "prompt")
    .slice()
    .sort((a, b) => a.order - b.order);
  for (const slot of promptSlots) {
    if (slot.edgeId === null) {
      continue;
    }
    const edge = edges[slot.edgeId];
    if (edge === undefined) {
      return "";
    }
    return sourceText(nodes[edge.sourceNodeId]);
  }
  return node.promptDraft ?? "";
}
