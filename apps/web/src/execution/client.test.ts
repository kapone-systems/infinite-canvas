/// <reference types="node" />
import assert from "node:assert/strict";
import { test } from "node:test";
import { USER_FACING } from "@canvas/schema";
import { EXECUTION_RUNS_PATH, postRun, retryFailed } from "./client.ts";
import { runEventsProtocols, runEventsUrl } from "./events.ts";
import { displayProgressLabel, overlayLabelFor } from "./progressDisplay.ts";
import { patchesFromSnapshot } from "./snapshot.ts";
import { progressModeAttr, taskStatusAttr } from "./taskStatus.ts";

test("postRun 只 POST RunRequest 到 /api/execution/runs", async () => {
  const calls: Array<{ url: string; method: string; body: string }> = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({
      url: String(input),
      method: init?.method ?? "GET",
      body: typeof init?.body === "string" ? init.body : "",
    });
    return new Response(
      JSON.stringify({
        runId: "r1",
        projectId: "p",
        scope: { type: "node", nodeId: "n1" },
        force: false,
        state: "running",
        plan: { nodes: [], summary: "" },
        tasks: [],
        summary: USER_FACING.handingToLocalQueue,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }) as typeof fetch;
  try {
    const request = {
      projectId: "p",
      scope: { type: "node" as const, nodeId: "n1" },
      force: false,
      clientRequestId: "cid",
    };
    const result = await postRun("tok", request);
    assert.equal(result.ok, true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.url, EXECUTION_RUNS_PATH);
    assert.equal(calls[0]?.url, "/api/execution/runs");
    assert.equal(calls[0]?.method, "POST");
    const body = JSON.parse(calls[0]?.body ?? "{}") as Record<string, unknown>;
    assert.deepEqual(Object.keys(body).sort(), ["clientRequestId", "force", "projectId", "scope"]);
    assert.equal("workflow" in body, false);
    assert.equal("comfyBaseUrl" in body, false);
  } finally {
    globalThis.fetch = original;
  }
});

test("进度主句去掉百分号；计算节点名不会作为主句出现在这里", () => {
  assert.equal(displayProgressLabel("12%"), USER_FACING.generatingElapsed("…"));
  assert.equal(displayProgressLabel("12%")?.includes("%"), false);
  assert.equal(displayProgressLabel(USER_FACING.handingToLocalQueue), "正在交给本机队列");
  assert.equal(
    overlayLabelFor({
      optimisticLabel: USER_FACING.handingToLocalQueue,
      progressLabel: "other",
      lastError: null,
    }),
    "正在交给本机队列",
  );
  assert.equal(
    overlayLabelFor({
      optimisticLabel: null,
      progressLabel: null,
      lastError: USER_FACING.cancelledNoResult,
    }),
    "已取消，没有新结果",
  );
  assert.equal(
    overlayLabelFor({
      optimisticLabel: null,
      progressLabel: null,
      lastError: USER_FACING.tooLateToCancel,
      hasOutput: true,
    }),
    null,
  );
  assert.equal(
    overlayLabelFor({
      optimisticLabel: null,
      progressLabel: null,
      lastError: USER_FACING.tooLateToCancel,
      hasOutput: false,
    }),
    USER_FACING.tooLateToCancel,
  );
  assert.equal(
    overlayLabelFor({
      optimisticLabel: null,
      progressLabel: null,
      lastError: USER_FACING.generationIncomplete,
      hasOutput: true,
    }),
    null,
  );
  assert.equal(
    overlayLabelFor({
      optimisticLabel: null,
      progressLabel: null,
      lastError: USER_FACING.generationIncomplete,
      hasOutput: false,
    }),
    USER_FACING.generationIncomplete,
  );
});

test("WS 地址不含查询串 token；子协议 canvas-bearer", () => {
  const url = runEventsUrl("run-1", { protocol: "http:", host: "127.0.0.1:5173" });
  assert.equal(url.includes("token="), false);
  assert.equal(url.startsWith("ws://127.0.0.1:5173/api/execution/runs/"), true);
  assert.deepEqual(runEventsProtocols("abc"), ["canvas-bearer", "canvas-bearer.abc"]);
});

test("刷新 snapshot 仍 running 才恢复 phase/label", () => {
  const patches = patchesFromSnapshot({
    runId: "r",
    projectId: "p",
    scope: { type: "node", nodeId: "n" },
    force: false,
    state: "running",
    plan: { nodes: [], summary: "" },
    tasks: [
      {
        taskId: "t",
        runId: "r",
        projectId: "p",
        nodeId: "n",
        lane: "local",
        recipeId: "recipe.image.txt2img.fictional",
        recipeVersion: 1,
        state: "running",
        fingerprintAtStart: "fp",
        variants: [],
        error: null,
        createdAt: "2026-09-24T00:00:00.000Z",
        updatedAt: "2026-09-24T00:00:00.000Z",
      },
    ],
    summary: "",
  });
  assert.equal(patches[0]?.patch.phase, "running");
  assert.equal(patches[0]?.patch.progress?.label, USER_FACING.generatingElapsed("…"));
  assert.equal(patchesFromSnapshot({
    runId: "r",
    projectId: "p",
    scope: { type: "node", nodeId: "n" },
    force: false,
    state: "succeeded",
    plan: { nodes: [], summary: "" },
    tasks: [],
    summary: "",
  }).length, 0);
});

test("data-task-status / data-progress-mode", () => {
  const node = {
    id: "n",
    kind: "generation" as const,
    title: "g",
    x: 0,
    y: 0,
    width: 320,
    height: 240,
    z: 1,
    groupId: null,
    origin: "authored" as const,
    createdAt: "2026-09-24T00:00:00.000Z",
    updatedAt: "2026-09-24T00:00:00.000Z",
    outputRevision: 1,
    phase: "running" as const,
    progress: { ratio: null, label: USER_FACING.generatingElapsed("…") },
  };
  assert.equal(taskStatusAttr(node, true), "cancelling");
  assert.equal(taskStatusAttr(node, false), "running");
  assert.equal(progressModeAttr(node), "indeterminate");
  assert.equal(progressModeAttr({ ...node, progress: { ratio: 0.5, label: null } }), "determinate");
});

test("retryFailed 打 POST /api/execution/runs/:runId/retry-failed", async () => {
  const calls: Array<{ url: string; method: string }> = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), method: init?.method ?? "GET" });
    return new Response(
      JSON.stringify({
        runId: "r2",
        projectId: "p",
        scope: { type: "node", nodeId: "n1" },
        force: false,
        state: "running",
        plan: { nodes: [], summary: "" },
        tasks: [],
        summary: USER_FACING.handingToLocalQueue,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }) as typeof fetch;
  try {
    const result = await retryFailed("tok", "run-9");
    assert.equal(result.ok, true);
    assert.equal(calls[0]?.method, "POST");
    assert.equal(calls[0]?.url, "/api/execution/runs/run-9/retry-failed");
  } finally {
    globalThis.fetch = original;
  }
});
