/**
 * 方案第 5.6 节用户主徽章。严格按表顺序，命中就停。
 * 有成功看 versions 成功格，不能只看 phase=idle。
 */

import { USER_FACING } from "./userFacingMessages.ts";
import type { ProjectNode } from "./types.ts";

export type UserBadge = "empty" | "queued" | "running" | "succeeded" | "failed" | "stale";

export function hasSucceededVariant(node: ProjectNode): boolean {
  for (const version of node.versions ?? []) {
    for (const variant of version.variants) {
      if (variant.phase === "succeeded") {
        return true;
      }
    }
  }
  return false;
}

export function userBadgeLabel(badge: UserBadge): string {
  switch (badge) {
    case "empty":
      return USER_FACING.badgeEmpty;
    case "queued":
      return USER_FACING.badgeQueued;
    case "running":
      return USER_FACING.badgeRunning;
    case "succeeded":
      return USER_FACING.badgeSucceeded;
    case "failed":
      return USER_FACING.badgeFailed;
    case "stale":
      return USER_FACING.badgeStale;
  }
}

/**
 * @param currentFingerprint 现在的输入指纹。省略时用 freshness=stale 作为第 5 步。
 */
export function generationBadge(
  node: ProjectNode,
  currentFingerprint?: string | null,
): UserBadge {
  if (node.phase === "queued") {
    return "queued";
  }
  if (node.phase === "running") {
    return "running";
  }
  const hasSuccess = hasSucceededVariant(node);
  if (!hasSuccess) {
    if (node.phase === "failed") {
      return "failed";
    }
    return "empty";
  }
  const successFp = node.lastSuccessFingerprint ?? null;
  if (currentFingerprint !== undefined) {
    if (currentFingerprint !== successFp) {
      return "stale";
    }
  } else if (node.freshness === "stale") {
    return "stale";
  }
  if (node.phase === "failed") {
    const attemptFp = node.lastAttemptFingerprint ?? null;
    if (currentFingerprint === undefined || currentFingerprint === attemptFp) {
      return "failed";
    }
  }
  return "succeeded";
}

export const userBadge = generationBadge;
