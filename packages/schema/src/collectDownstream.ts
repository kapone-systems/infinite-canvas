/**
 * 方案第 5.1 节：下游是沿输出线能走到的生成节点，不含起点。
 * 中间穿过素材节点时继续往下走。
 */

import type { ProjectEdge, ProjectNode } from "./types.ts";

export function collectDownstream(
  fromNodeId: string,
  nodes: Record<string, ProjectNode>,
  edges: Record<string, ProjectEdge>,
): string[] {
  const outgoing = new Map<string, string[]>();
  for (const edge of Object.values(edges)) {
    const list = outgoing.get(edge.sourceNodeId);
    if (list !== undefined) {
      list.push(edge.targetNodeId);
    } else {
      outgoing.set(edge.sourceNodeId, [edge.targetNodeId]);
    }
  }

  const ordered: string[] = [];
  const seen = new Set<string>([fromNodeId]);
  const queue: string[] = [fromNodeId];
  while (queue.length > 0) {
    const id = queue.shift();
    if (id === undefined) {
      break;
    }
    for (const next of outgoing.get(id) ?? []) {
      if (seen.has(next)) {
        continue;
      }
      seen.add(next);
      queue.push(next);
      if (nodes[next]?.kind === "generation") {
        ordered.push(next);
      }
    }
  }
  return ordered;
}
