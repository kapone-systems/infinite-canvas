/// <reference types="node" />
import assert from "node:assert/strict";
import { test } from "node:test";
import { USER_FACING } from "@canvas/schema";
import {
  DEFAULT_PROCESS_FAKE_BEHAVIOR,
  DEFAULT_PROCESS_FAKE_DELAY_MS,
  FakeExecutor,
  parseFakeExecutor,
} from "./fakeExecutor.ts";

test("真实进程默认 hang-then-succeed，不是 succeed-immediately", () => {
  const parsed = parseFakeExecutor([]);
  assert.equal(parsed.behavior, "hang-then-succeed");
  assert.equal(parsed.behavior, DEFAULT_PROCESS_FAKE_BEHAVIOR);
  assert.notEqual(parsed.behavior, "succeed-immediately");
  assert.equal(parsed.delayMs, DEFAULT_PROCESS_FAKE_DELAY_MS);
  assert.equal(parsed.failAtVariantIndex, null);
  assert.equal(parseFakeExecutor(["--fake-executor", "succeed-on-cancel"]).behavior, "succeed-on-cancel");
  assert.equal(parseFakeExecutor(["--fake-delay-ms", "50"]).delayMs, 50);
  assert.equal(parseFakeExecutor(["--fake-fail-at-variant", "1"]).failAtVariantIndex, 1);
});

test("hang-then-succeed 可被取消，超时后成功", async () => {
  const fake = new FakeExecutor({ behavior: "hang-then-succeed", delayMs: 40 });
  const submitted = await fake.submit({ taskId: "t", promptText: "hi", prompt: {} });
  const abort = new AbortController();
  const cancelled = fake.wait(submitted.promptId, abort.signal);
  abort.abort();
  const result = await cancelled;
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.message, USER_FACING.cancelledNoResult);
  }

  const fake2 = new FakeExecutor({ behavior: "hang-then-succeed", delayMs: 20 });
  const submitted2 = await fake2.submit({ taskId: "t2", promptText: "hi", prompt: {} });
  const ok = await fake2.wait(submitted2.promptId, new AbortController().signal);
  assert.equal(ok.ok, true);
});
