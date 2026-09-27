/**
 * 方案第 1.3 / 5.8 节：用户编辑只标过期，不自动重跑，不打执行 HTTP。
 * 只标下游生成节点 freshness=stale，不含起点。
 * 调用方对「目标及其下游」须对目标再标一次。
 */

import { collectDownstream } from "./collectDownstream.ts";
import type { ProjectEdge, ProjectNode } from "./types.ts";

export function markNodeStale(node: ProjectNode): ProjectNode {
  const next: ProjectNode = { ...node, freshness: "stale" };
  if (node.phase === "queued" || node.phase === "running") {
    next.inputsChangedWhileRunning = true;
  }
  return next;
}

export function applyStaleFrom(
  nodes: Record<string, ProjectNode>,
  edges: Record<string, ProjectEdge>,
  fromNodeId: string,
): string[] {
  const ids = collectDownstream(fromNodeId, nodes, edges);
  for (const id of ids) {
    const node = nodes[id];
    if (node === undefined || node.kind !== "generation") {
      continue;
    }
    nodes[id] = markNodeStale(node);
  }
  return ids;
}
