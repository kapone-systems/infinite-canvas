/**
 * 方案阶段 4：过滤显示中的计算节点名。
 * KSampler / VAE / CLIP / Load Checkpoint 只允许出现在本文件，不得进 web 与 userFacingMessages。
 */
import { USER_FACING } from "@canvas/schema";

const COMPUTE_NODE_NAME = /KSampler|\bVAE\b|\bCLIP\b|Load Checkpoint/i;

export function filterComputeNodeName(raw: string | null | undefined): string {
  const text = raw?.trim() ?? "";
  if (text.length === 0 || COMPUTE_NODE_NAME.test(text)) {
    return USER_FACING.generatingLabel;
  }
  return text;
}

export function runningProgressLabel(rawNodeTitle?: string | null): string {
  const filtered = filterComputeNodeName(rawNodeTitle);
  if (filtered === USER_FACING.generatingLabel) {
    return USER_FACING.generatingElapsed("…");
  }
  return filtered.includes("%") ? USER_FACING.generatingElapsed("…") : filtered;
}
