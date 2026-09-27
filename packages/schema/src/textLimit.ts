import { USER_FACING } from "./userFacingMessages.ts";

/** 方案阶段 1 / 画布说明选定上限：超过 100000 字符拒绝。 */
export const TEXT_MAX_CHARS = 100000;

export function isTextOverLimit(text: string): boolean {
  return text.length > TEXT_MAX_CHARS;
}

export function textOverLimitIssue(): {
  ok: false;
  httpStatus: 400;
  message: string;
  code: "text_too_long";
} {
  return {
    ok: false,
    httpStatus: 400,
    message: USER_FACING.textTooLong,
    code: "text_too_long",
  };
}
