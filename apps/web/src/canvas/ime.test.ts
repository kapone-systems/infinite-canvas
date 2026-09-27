/// <reference types="node" />
import assert from "node:assert/strict";
import { test } from "node:test";
import { createImeTracker, shouldCommitTextCommand } from "./ime.ts";

test("compositionstart 到 compositionend 之间不提交命令", () => {
  const ime = createImeTracker();
  assert.equal(ime.isComposing(), false);
  assert.equal(shouldCommitTextCommand(ime.isComposing()), true);

  ime.start();
  assert.equal(ime.isComposing(), true);
  assert.equal(shouldCommitTextCommand(ime.isComposing()), false);

  ime.end();
  assert.equal(ime.isComposing(), false);
  assert.equal(shouldCommitTextCommand(ime.isComposing()), true);
});

test("组字中途再次 start 仍视为组字", () => {
  const ime = createImeTracker();
  ime.start();
  ime.start();
  assert.equal(shouldCommitTextCommand(ime.isComposing()), false);
  ime.end();
  assert.equal(shouldCommitTextCommand(ime.isComposing()), true);
});

test("compositionupdate 不是已上屏：组字中 shouldCommit 为 false", () => {
  const ime = createImeTracker();
  ime.start();
  assert.equal(shouldCommitTextCommand(true), false);
  assert.equal(shouldCommitTextCommand(ime.isComposing()), false);
});
