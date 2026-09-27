import { USER_FACING } from "./userFacingMessages.ts";

/**
 * 检查器看见没钥匙的短句之后，自己写下一行。
 * 不读取响应里的 detail 或其他字段。
 */
export function inspectorSecretFollowUp(seenMessage: string | null): string | null {
  if (seenMessage === USER_FACING.secretMissing) {
    return USER_FACING.secretRefillOnThisComputer;
  }
  return null;
}
