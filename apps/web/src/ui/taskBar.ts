/**
 * 本地与云端任务条分开数。同时展开的运行明细不超过 8 条。
 * 不合成一根进度。
 */

export const RUNNING_DETAIL_LIMIT = 8;

export type RunningNodeLike = {
  id: string;
  kind: string;
  title: string;
  phase?: string | null;
  runner?: string | null;
  progress?: { ratio: number | null; label: string | null } | null;
};

export type RunningDetail = {
  id: string;
  lane: "local" | "cloud";
  label: string;
};

export type FoldedLane = {
  shown: RunningDetail[];
  hidden: number;
};

export function runningDetailsFromNodes(nodes: readonly RunningNodeLike[]): RunningDetail[] {
  const details: RunningDetail[] = [];
  for (const node of nodes) {
    if (node.kind !== "generation") {
      continue;
    }
    if (node.phase !== "queued" && node.phase !== "running") {
      continue;
    }
    details.push({
      id: node.id,
      lane: node.runner === "cloud" ? "cloud" : "local",
      label: node.progress?.label ?? node.title,
    });
  }
  return details;
}

export function foldRunningDetails(items: readonly RunningDetail[]): { local: FoldedLane; cloud: FoldedLane } {
  const fold = (rows: readonly RunningDetail[]): FoldedLane => {
    if (rows.length <= RUNNING_DETAIL_LIMIT) {
      return { shown: [...rows], hidden: 0 };
    }
    return {
      shown: rows.slice(0, RUNNING_DETAIL_LIMIT),
      hidden: rows.length - RUNNING_DETAIL_LIMIT,
    };
  };
  return {
    local: fold(items.filter((item) => item.lane === "local")),
    cloud: fold(items.filter((item) => item.lane === "cloud")),
  };
}

export function inspectorErrorLines(
  error: { message: string; detail?: string } | null | undefined,
): { message: string; detail: string | null } | null {
  if (error == null || error.message.length === 0) {
    return null;
  }
  const detail = error.detail;
  return {
    message: error.message,
    detail: detail != null && detail.length > 0 ? detail : null,
  };
}
