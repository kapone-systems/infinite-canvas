import type { Phase, ProjectNode, RunSnapshot } from "@canvas/schema";
import { USER_FACING } from "@canvas/schema";

export function patchesFromSnapshot(
  snapshot: RunSnapshot,
): Array<{ nodeId: string; patch: Partial<ProjectNode> }> {
  if (snapshot.state !== "running") {
    return [];
  }
  const out: Array<{ nodeId: string; patch: Partial<ProjectNode> }> = [];
  for (const task of snapshot.tasks) {
    let phase: Phase | null = null;
    let label: string | null = null;
    if (task.state === "queued") {
      phase = "queued";
      label = USER_FACING.handingToLocalQueue;
    } else if (task.state === "submitted" || task.state === "running") {
      phase = "running";
      label = USER_FACING.generatingElapsed("…");
    }
    if (phase === null) {
      continue;
    }
    out.push({
      nodeId: task.nodeId,
      patch: {
        phase,
        lastRunId: snapshot.runId,
        lastTaskId: task.taskId,
        progress: { ratio: null, label },
        runner: task.lane,
      },
    });
  }
  return out;
}

export function runningRunIds(nodes: Iterable<ProjectNode>): string[] {
  const ids = new Set<string>();
  for (const node of nodes) {
    if (node.kind !== "generation") {
      continue;
    }
    if (node.phase !== "queued" && node.phase !== "running") {
      continue;
    }
    const runId = node.lastRunId;
    if (runId != null && runId.length > 0) {
      ids.add(runId);
    }
  }
  return [...ids];
}
