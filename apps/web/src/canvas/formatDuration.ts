import { COPY } from "../ui/copy.ts";

/** 没有时长或非正数显示「时长未知」，不要写成 0:00。 */
export function formatDuration(durationMs: number | null): string {
  if (durationMs == null || durationMs <= 0) {
    return COPY.durationUnknown;
  }
  const total = Math.round(durationMs / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}
