import assert from "node:assert/strict";
import { test } from "node:test";
import { isTextOverLimit, TEXT_MAX_CHARS, textOverLimitIssue } from "./textLimit.ts";
import { USER_FACING } from "./userFacingMessages.ts";

test("100000 字符未超限，100001 超限并带主句", () => {
  assert.equal(TEXT_MAX_CHARS, 100000);
  assert.equal(isTextOverLimit("a".repeat(TEXT_MAX_CHARS)), false);
  assert.equal(isTextOverLimit("a".repeat(TEXT_MAX_CHARS + 1)), true);
  const issue = textOverLimitIssue();
  assert.equal(issue.ok, false);
  assert.equal(issue.httpStatus, 400);
  assert.equal(issue.message, "文本太长，没有放进节点。");
  assert.equal(issue.message, USER_FACING.textTooLong);
});
