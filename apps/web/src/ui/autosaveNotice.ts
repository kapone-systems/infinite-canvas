import { USER_FACING } from "@canvas/schema";

/** 页面已经打开时要不要去问自动保存失败。手势中不发这次查询。 */
export function autosaveNoticeWhileOpen(input: { gestureActive: boolean }): { query: boolean } {
  return { query: input.gestureActive !== true };
}

export function noticeFromAutosaveError(message: string | undefined): string | null {
  if (message === USER_FACING.autosaveFailed) {
    return USER_FACING.autosaveFailed;
  }
  return null;
}
