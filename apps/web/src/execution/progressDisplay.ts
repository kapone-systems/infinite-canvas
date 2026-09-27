/**
 * 画布进度主句。计算节点名已在后端 progressLabel 过滤，这里只去掉百分号。
 */
import { USER_FACING } from "@canvas/schema";

export function displayProgressLabel(label: string | null | undefined): string | null {
  if (label == null) {
    return null;
  }
  const text = label.trim();
  if (text.length === 0) {
    return null;
  }
  if (text.includes("%")) {
    return USER_FACING.generatingElapsed("…");
  }
  return text;
}

export function overlayLabelFor(input: {
  optimisticLabel: string | null;
  progressLabel: string | null | undefined;
  lastError: string | null | undefined;
  /** 已有成功输出时，「来不及取消」不得盖住缩略图。 */
  hasOutput?: boolean;
}): string | null {
  const optimistic = displayProgressLabel(input.optimisticLabel);
  if (optimistic !== null) {
    return optimistic;
  }
  const progress = displayProgressLabel(input.progressLabel);
  if (progress !== null) {
    return progress;
  }
  const error = input.lastError ?? null;
  if (error === USER_FACING.tooLateToCancel) {
    return input.hasOutput === true ? null : error;
  }
  if (error === USER_FACING.generationIncomplete) {
    return input.hasOutput === true ? null : error;
  }
  if (
    error === USER_FACING.cancelledNoResult ||
    error === USER_FACING.cancelUncertain
  ) {
    return error;
  }
  return null;
}
