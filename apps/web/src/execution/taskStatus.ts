import type { ProjectNode } from "@canvas/schema";

export type TaskStatusAttr = "idle" | "queued" | "running" | "cancelling" | "succeeded" | "failed";
export type ProgressModeAttr = "determinate" | "indeterminate";

export function taskStatusAttr(node: ProjectNode, cancelling: boolean): TaskStatusAttr {
  if (cancelling && (node.phase === "queued" || node.phase === "running" || node.phase === "idle")) {
    return "cancelling";
  }
  if (node.phase === "queued") {
    return "queued";
  }
  if (node.phase === "running") {
    return "running";
  }
  if (node.phase === "succeeded") {
    return "succeeded";
  }
  if (node.phase === "failed") {
    return "failed";
  }
  return "idle";
}

export function progressModeAttr(node: ProjectNode): ProgressModeAttr {
  const ratio = node.progress?.ratio;
  if (typeof ratio === "number" && Number.isFinite(ratio)) {
    return "determinate";
  }
  return "indeterminate";
}
