/**
 * 方案第 9.3 / 阶段 7：视频要时长、首帧、尾帧、封面、代理都在才算成功。
 * 只有原件的 output 不是成功，避免「有 output 即成功」把预览未齐打成 succeeded。
 */

import { hasSucceededVariant } from "./generationBadge.ts";
import type { MediaRef, ProjectNode } from "./types.ts";

function filled(path: string | null | undefined): path is string {
  return typeof path === "string" && path.length > 0;
}

export function videoDerivativesReady(media: MediaRef | null | undefined): boolean {
  if (media == null || media.kind !== "video") {
    return false;
  }
  return (
    media.contentHash != null &&
    media.contentHash.length > 0 &&
    filled(media.relativePath) &&
    media.durationMs != null &&
    media.durationMs > 0 &&
    filled(media.firstFrameRelativePath) &&
    filled(media.lastFrameRelativePath) &&
    filled(media.coverRelativePath) &&
    filled(media.proxyRelativePath)
  );
}

/** 原片已落到节点，封面或代理还没齐。图片节点不是这个状态。 */
export function videoPreviewPending(node: ProjectNode): boolean {
  const output = node.output ?? null;
  if (output == null) {
    return false;
  }
  const video = output.kind === "video" || node.outputKind === "video";
  if (!video || output.kind !== "video") {
    return false;
  }
  return !videoDerivativesReady(output);
}

/**
 * 阶段 4 图片：有 output 仍算成功。
 * 阶段 7 视频：未齐的原件不算成功，刷新和取消回到 idle，不改成 succeeded。
 */
export function generationHasSettledSuccess(node: ProjectNode): boolean {
  if (hasSucceededVariant(node)) {
    return true;
  }
  if (node.lastSuccessFingerprint != null && node.lastSuccessFingerprint !== "") {
    return true;
  }
  if (node.output == null) {
    return false;
  }
  if (node.output.kind === "video" || node.outputKind === "video") {
    return videoDerivativesReady(node.output);
  }
  return true;
}
