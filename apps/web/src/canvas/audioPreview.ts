import type { MediaRef } from "@canvas/schema";

/** 没有音频媒体时不显示时长。有媒体才用 durationMs，空时长留给 formatDuration。 */
export function audioRelativePath(output: MediaRef | null | undefined): string | null {
  if (output == null || output.kind !== "audio") {
    return null;
  }
  if (output.relativePath.length === 0) {
    return null;
  }
  return output.relativePath;
}

/**
 * 工作副本还没同步时不要要票据。服务端只认当前工程，刚拖入会 403。
 * 未选中也不要请求，避免远景或失选之后还挂着会出声的地址。
 */
export function shouldRequestAudioTicket(input: {
  selected: boolean;
  needsWorkingCopySync: boolean;
  token: string | null;
  relativePath: string | null;
}): boolean {
  return (
    input.selected &&
    !input.needsWorkingCopySync &&
    input.token !== null &&
    input.token.length > 0 &&
    input.relativePath !== null &&
    input.relativePath.length > 0
  );
}

export function audioTicketSrc(ticketId: string): string {
  return `/api/media-ticket/${ticketId}`;
}

/** 只有选中且地址是后端票据才挂 audio。失选或同步中卸掉，出声停止。 */
export function shouldMountAudioElement(input: {
  selected: boolean;
  needsWorkingCopySync: boolean;
  src: string | null;
}): boolean {
  return (
    input.selected &&
    !input.needsWorkingCopySync &&
    input.src !== null &&
    input.src.startsWith("/api/media-ticket/")
  );
}
