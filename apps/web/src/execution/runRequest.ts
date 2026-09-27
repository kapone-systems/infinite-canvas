/**
 * 阶段 3：三个运行按钮只构造 RunScope / RunRequest，不 fetch、不入队。
 * force 规则见方案第 5.7 节。
 */

import type { ProjectNode, RunRequest, RunScope, UserBadge } from "@canvas/schema";
import { USER_FACING } from "@canvas/schema";

export function buildRunRequest(input: {
  projectId: string;
  clientRequestId: string;
  scope: RunScope;
  force: boolean;
}): RunRequest {
  return {
    projectId: input.projectId,
    scope: input.scope,
    force: input.scope.type === "downstream" ? false : input.force,
    clientRequestId: input.clientRequestId,
  };
}

export function nodeRunForce(
  badge: UserBadge,
  confirmed: boolean,
): { force: boolean; needsConfirm: boolean; confirmMessage: string | null } {
  if (badge === "succeeded") {
    if (!confirmed) {
      return {
        force: false,
        needsConfirm: true,
        confirmMessage: USER_FACING.runFreshConfirm,
      };
    }
    return { force: true, needsConfirm: false, confirmMessage: null };
  }
  return { force: false, needsConfirm: false, confirmMessage: null };
}

export function selectionHasGeneration(nodes: readonly ProjectNode[]): boolean {
  return nodes.some((node) => node.kind === "generation");
}

export function selectionRunForce(
  hasFreshSuccess: boolean,
  confirmed: boolean,
): { force: boolean; needsConfirm: boolean; confirmMessage: string | null } {
  if (hasFreshSuccess && !confirmed) {
    return {
      force: false,
      needsConfirm: true,
      confirmMessage: USER_FACING.runSelectionConfirm,
    };
  }
  return {
    force: hasFreshSuccess && confirmed,
    needsConfirm: false,
    confirmMessage: null,
  };
}
