import assert from "node:assert/strict";
import { test } from "node:test";
import { USER_FACING } from "@canvas/schema";
import { autosaveNoticeWhileOpen, noticeFromAutosaveError } from "./autosaveNotice.ts";

test("手势中不查询；页面上的自动保存失败用方案原句", () => {
  assert.equal(autosaveNoticeWhileOpen({ gestureActive: true }).query, false);
  assert.equal(autosaveNoticeWhileOpen({ gestureActive: false }).query, true);
  assert.equal(noticeFromAutosaveError(USER_FACING.autosaveFailed), "自动保存失败，当前修改还在这个页面上。");
  assert.equal(noticeFromAutosaveError("别的句子"), null);
  assert.equal(noticeFromAutosaveError(undefined), null);
});
