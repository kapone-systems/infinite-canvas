/// <reference types="node" />
import assert from "node:assert/strict";
import { test } from "node:test";
import { USER_FACING, type RunRequest, type RunSnapshot } from "@canvas/schema";
import {
  attachTaskIds,
  isThisNodeBusy,
  optimisticAfterCancel,
  optimisticClearedByPatch,
  optimisticFromEmit,
  submitEmittedRun,
} from "./runFlow.ts";

function request(): RunRequest {
  return {
    projectId: "p",
    scope: { type: "node", nodeId: "g1" },
    force: false,
    clientRequestId: "cid-1",
  };
}

function snapshot(): RunSnapshot {
  return {
    runId: "run-1",
    projectId: "p",
    scope: { type: "node", nodeId: "g1" },
    force: false,
    state: "running",
    plan: { nodes: [], summary: "" },
    tasks: [
      {
        taskId: "task-1",
        runId: "run-1",
        projectId: "p",
        nodeId: "g1",
        lane: "local",
        recipeId: "recipe.image.txt2img.fictional",
        recipeVersion: 1,
        state: "queued",
        fingerprintAtStart: "fp",
        variants: [],
        error: null,
        createdAt: "2026-09-24T00:00:00.000Z",
        updatedAt: "2026-09-24T00:00:00.000Z",
      },
    ],
    summary: USER_FACING.handingToLocalQueue,
  };
}

test("确认未通过不 flush 不 POST", async () => {
  let flushed = 0;
  let posted = 0;
  const result = await submitEmittedRun({
    emit: {
      ok: false,
      needsConfirm: true,
      message: USER_FACING.runFreshConfirm,
      confirmMessage: USER_FACING.runFreshConfirm,
    },
    nodeId: "g1",
    flushWorkingCopy: async () => {
      flushed += 1;
      return true;
    },
    postRun: async () => {
      posted += 1;
      return { ok: true, status: 200, data: snapshot() };
    },
    setOptimistic: () => undefined,
  });
  assert.equal(result.posted, false);
  assert.equal(result.needsConfirm, true);
  assert.equal(flushed, 0);
  assert.equal(posted, 0);
});

test("工作副本失败不 POST 并撤回乐观", async () => {
  const labels: Array<string | null> = [];
  const result = await submitEmittedRun({
    emit: { ok: true, request: request() },
    nodeId: "g1",
    flushWorkingCopy: async () => false,
    postRun: async () => {
      throw new Error("should not post");
    },
    setOptimistic: (value) => {
      labels.push(value?.label ?? null);
    },
  });
  assert.equal(result.posted, false);
  assert.equal(result.message, USER_FACING.workingCopySyncFailed);
  assert.equal(labels[0], USER_FACING.handingToLocalQueue);
  assert.equal(labels[1], null);
});

test("成功路径乐观主句交给本机队列，POST 同一份 RunRequest", async () => {
  const req = request();
  let postedBody: RunRequest | null = null;
  const result = await submitEmittedRun({
    emit: { ok: true, request: req },
    nodeId: "g1",
    flushWorkingCopy: async () => true,
    postRun: async (body) => {
      postedBody = body;
      return { ok: true, status: 200, data: snapshot() };
    },
    setOptimistic: () => undefined,
  });
  assert.equal(result.posted, true);
  assert.equal(postedBody === req, true);
  assert.equal(req.clientRequestId, "cid-1");
});

test("预检失败撤回乐观", async () => {
  const labels: Array<string | null> = [];
  const result = await submitEmittedRun({
    emit: { ok: true, request: request() },
    nodeId: "g1",
    flushWorkingCopy: async () => true,
    postRun: async () => ({
      ok: false,
      status: 400,
      message: USER_FACING.comfyUnconfigured,
      network: false,
    }),
    setOptimistic: (value) => {
      labels.push(value?.label ?? null);
    },
  });
  assert.equal(result.posted, false);
  assert.equal(result.message, USER_FACING.comfyUnconfigured);
  assert.equal(labels[0], USER_FACING.handingToLocalQueue);
  assert.equal(labels.at(-1), null);
});

test("取消立刻 cancelling；无 taskId 则 pendingCancel", () => {
  const opt = optimisticFromEmit(request(), "g1");
  assert.equal(opt.label, "正在交给本机队列");
  const noId = optimisticAfterCancel(opt, null);
  assert.equal(noId.cancelling, true);
  assert.equal(noId.pendingCancel, true);
  assert.equal(noId.label, USER_FACING.cancelling);
  const withId = optimisticAfterCancel(opt, "task-1");
  assert.equal(withId.pendingCancel, false);
  assert.equal(withId.taskId, "task-1");
  const attached = attachTaskIds(opt, snapshot());
  assert.equal(attached.taskId, "task-1");
  assert.equal(attached.runId, "run-1");
});

test("idle 节点在乐观层也算忙，按钮应变取消", () => {
  assert.equal(
    isThisNodeBusy({ nodeId: "g1", phase: "idle", optimisticThis: { nodeId: "g1", cancelling: false } }),
    true,
  );
  assert.equal(isThisNodeBusy({ nodeId: "g1", phase: "queued", optimisticThis: null }), true);
  assert.equal(isThisNodeBusy({ nodeId: "g1", phase: "idle", optimisticThis: null }), false);
  assert.equal(
    isThisNodeBusy({ nodeId: "g2", phase: "idle", optimisticThis: { nodeId: "g1", cancelling: false } }),
    false,
  );
});

test("成功或空闲的补丁会清掉正在交给本机队列", () => {
  assert.equal(optimisticClearedByPatch("queued"), true);
  assert.equal(optimisticClearedByPatch("running"), true);
  assert.equal(optimisticClearedByPatch("succeeded"), true);
  assert.equal(optimisticClearedByPatch("idle"), true);
  assert.equal(optimisticClearedByPatch("failed"), true);
  assert.equal(optimisticClearedByPatch(undefined), false);
});
