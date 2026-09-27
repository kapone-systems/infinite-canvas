import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import {
  RECIPE_TXT2IMG,
  USER_FACING,
  blobRelPath,
  type MediaRef,
  type RunEvent,
  type RunPlan,
} from "@canvas/schema";
import { APP_FOLDER_NAME } from "../appData.ts";
import {
  EXECUTION_DB_FILENAME,
  TaskStoreError,
  executionSqlitePath,
  openTaskStore,
  type InsertQueuedInput,
} from "./taskStore.ts";

const FINGERPRINT = "ab".repeat(32);
const NOW = "2026-09-24T12:00:00.000Z";
const LATER = "2026-09-24T12:00:05.000Z";
const DONE = "2026-09-24T12:00:10.000Z";

function mediaRef(hash = FINGERPRINT): MediaRef {
  return {
    kind: "image",
    relativePath: blobRelPath(hash),
    contentHash: hash,
    byteSize: 128,
    mimeDetected: "image/png",
    width: 8,
    height: 8,
    durationMs: null,
    firstFrameRelativePath: null,
    lastFrameRelativePath: null,
    coverRelativePath: null,
    proxyRelativePath: null,
    thumbRelativePath: `media/derived/${hash.slice(0, 2)}/${hash}/thumb-webp-longedge-512-v1.webp`,
  };
}

function planFor(nodeId: string): RunPlan {
  return { nodes: [{ nodeId, action: "run", message: USER_FACING.handingToLocalQueue }], summary: "1" };
}

function queuedInput(overrides: Partial<InsertQueuedInput> = {}): InsertQueuedInput {
  const runId = overrides.runId ?? "run-1";
  const nodeId = "node-1";
  const taskId = "task-1";
  return {
    runId,
    projectId: "proj-1",
    clientRequestId: "client-1",
    scope: { type: "node", nodeId },
    force: false,
    plan: planFor(nodeId),
    summary: USER_FACING.handingToLocalQueue,
    tasks: [
      {
        taskId,
        nodeId,
        lane: "local",
        recipeId: RECIPE_TXT2IMG,
        recipeVersion: 1,
        fingerprintAtStart: FINGERPRINT,
        variants: [
          {
            index: 0,
            state: "queued",
            seedUsed: null,
            outputs: [],
            error: null,
            providerJobId: null,
          },
        ],
      },
    ],
    now: NOW,
    ...overrides,
  };
}

async function withStore(
  fn: (store: ReturnType<typeof openTaskStore>, dataDir: string, projectDir: string) => Promise<void> | void,
): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "canvas-taskstore-"));
  const dataDir = join(root, "data");
  const projectDir = join(root, "project");
  await mkdir(dataDir, { recursive: true });
  await mkdir(projectDir, { recursive: true });
  const store = openTaskStore(dataDir);
  try {
    await fn(store, dataDir, projectDir);
  } finally {
    store.close();
    await rm(root, { recursive: true, force: true });
  }
}

test("库文件在传入 dataDir/execution.sqlite，不进工程目录，也不写真实 CanvasApp", async () => {
  await withStore((store, dataDir, projectDir) => {
    const expected = resolve(join(dataDir, EXECUTION_DB_FILENAME));
    assert.equal(store.sqlitePath, expected);
    assert.equal(executionSqlitePath(dataDir), expected);
    assert.equal(existsSync(expected), true);
    assert.equal(existsSync(join(projectDir, EXECUTION_DB_FILENAME)), false);
    assert.notEqual(store.sqlitePath, join(process.cwd(), EXECUTION_DB_FILENAME));
    const local = process.env.LOCALAPPDATA;
    if (local !== undefined && local.length > 0) {
      const realPath = join(local, APP_FOLDER_NAME, EXECUTION_DB_FILENAME);
      assert.notEqual(store.sqlitePath, realPath);
    }
  });
});

test("插入排队后可读回 RunSnapshot；同 clientRequestId 不双入队", async () => {
  await withStore((store) => {
    const first = store.insertQueued(queuedInput());
    assert.equal(first.runId, "run-1");
    assert.equal(first.state, "running");
    assert.equal(first.scope.type, "node");
    assert.equal(first.tasks.length, 1);
    const task = first.tasks[0];
    assert.ok(task);
    assert.equal(task.state, "queued");
    assert.equal(task.recipeId, RECIPE_TXT2IMG);
    assert.equal(task.fingerprintAtStart, FINGERPRINT);
    assert.equal(task.variants[0]?.state, "queued");
    assert.equal(first.summary, USER_FACING.handingToLocalQueue);
    const events = store.listEvents("run-1");
    assert.equal(events[0]?.type, "run.planned");
    assert.equal(events[1]?.type, "task.queued");
    const again = store.insertQueued(
      queuedInput({
        runId: "run-should-not-create",
        summary: "不该覆盖",
      }),
    );
    assert.equal(again.runId, "run-1");
    assert.equal(store.getRun("run-should-not-create"), null);
    assert.equal(store.getRunByClientRequestId("proj-1", "client-1")?.runId, "run-1");
  });
});

test("更新运行/成功/失败/取消/interrupted；同一事务；重启读回上一笔完整状态", async () => {
  const root = await mkdtemp(join(tmpdir(), "canvas-taskstore-restart-"));
  const dataDir = join(root, "data");
  await mkdir(dataDir, { recursive: true });
  let store = openTaskStore(dataDir);
  try {
    store.insertQueued(queuedInput());
    store.applyChanges({
      tasks: [
        {
          taskId: "task-1",
          state: "submitted",
          variants: [
            {
              index: 0,
              state: "running",
              seedUsed: 7,
              outputs: [],
              error: null,
              providerJobId: "prompt-1",
            },
          ],
        },
      ],
      events: [{ type: "task.submitted", runId: "run-1", taskId: "task-1", providerJobId: "prompt-1" }],
      now: LATER,
    });
    const running = store.applyChanges({
      tasks: [{ taskId: "task-1", state: "running" }],
      events: [{ type: "task.running", runId: "run-1", taskId: "task-1" }],
      now: LATER,
    });
    assert.equal(running.tasks[0]?.state, "running");
    store.close();

    store = openTaskStore(dataDir);
    const afterRestartRunning = store.getRun("run-1");
    assert.ok(afterRestartRunning);
    assert.equal(afterRestartRunning.state, "running");
    assert.equal(afterRestartRunning.tasks[0]?.state, "running");
    assert.equal(afterRestartRunning.tasks[0]?.variants[0]?.providerJobId, "prompt-1");
    assert.equal(
      store.listEvents("run-1").some((event) => event.type === "task.running"),
      true,
    );

    const output = mediaRef();
    const succeeded = store.applyChanges({
      tasks: [
        {
          taskId: "task-1",
          state: "succeeded",
          error: null,
          variants: [
            {
              index: 0,
              state: "succeeded",
              seedUsed: 7,
              outputs: [output],
              error: null,
              providerJobId: "prompt-1",
            },
          ],
        },
      ],
      run: { runId: "run-1", state: "succeeded", summary: USER_FACING.generatingLabel },
      events: [
        {
          type: "task.finished",
          runId: "run-1",
          taskId: "task-1",
          state: "succeeded",
          error: null,
        },
        { type: "run.finished", runId: "run-1", state: "succeeded", summary: USER_FACING.generatingLabel },
      ],
      now: DONE,
    });
    assert.equal(succeeded.state, "succeeded");
    assert.equal(succeeded.tasks[0]?.state, "succeeded");
    assert.equal(succeeded.tasks[0]?.variants[0]?.outputs[0]?.contentHash, FINGERPRINT);
    store.close();

    store = openTaskStore(dataDir);
    const afterSuccess = store.getRun("run-1");
    assert.ok(afterSuccess);
    assert.equal(afterSuccess.state, "succeeded");
    assert.equal(afterSuccess.tasks[0]?.state, "succeeded");
    assert.equal(afterSuccess.tasks[0]?.variants[0]?.outputs[0]?.relativePath, blobRelPath(FINGERPRINT));
    assert.equal(afterSuccess.tasks[0]?.updatedAt, DONE);
    const eventTypes = store.listEvents("run-1").map((event) => event.type);
    assert.deepEqual(eventTypes, [
      "run.planned",
      "task.queued",
      "task.submitted",
      "task.running",
      "task.finished",
      "run.finished",
    ]);
    store.close();

    store = openTaskStore(dataDir);
    store.insertQueued(
      queuedInput({
        runId: "run-fail",
        clientRequestId: "client-fail",
        tasks: [
          {
            taskId: "task-fail",
            nodeId: "node-1",
            lane: "local",
            recipeId: RECIPE_TXT2IMG,
            recipeVersion: 1,
            fingerprintAtStart: FINGERPRINT,
          },
        ],
      }),
    );
    const failed = store.applyChanges({
      tasks: [
        {
          taskId: "task-fail",
          state: "failed",
          error: { code: "GENERATION_INCOMPLETE", message: USER_FACING.generationIncomplete },
        },
      ],
      run: { runId: "run-fail", state: "failed", summary: USER_FACING.generationIncomplete },
      events: [
        {
          type: "task.finished",
          runId: "run-fail",
          taskId: "task-fail",
          state: "failed",
          error: { code: "GENERATION_INCOMPLETE", message: USER_FACING.generationIncomplete },
        },
      ],
      now: DONE,
    });
    assert.equal(failed.tasks[0]?.error?.message, USER_FACING.generationIncomplete);
    store.close();

    store = openTaskStore(dataDir);
    assert.equal(store.getRun("run-fail")?.state, "failed");
    assert.equal(store.getTask("task-fail")?.error?.message, "生成没有完成");
    store.close();

    store = openTaskStore(dataDir);
    store.insertQueued(
      queuedInput({
        runId: "run-cancel",
        clientRequestId: "client-cancel",
        tasks: [
          {
            taskId: "task-cancel",
            nodeId: "node-1",
            lane: "local",
            recipeId: RECIPE_TXT2IMG,
            recipeVersion: 1,
            fingerprintAtStart: FINGERPRINT,
          },
        ],
      }),
    );
    store.applyChanges({
      tasks: [
        {
          taskId: "task-cancel",
          state: "cancelled",
          error: { code: "CANCELLED", message: USER_FACING.cancelledNoResult },
        },
      ],
      run: { runId: "run-cancel", state: "cancelled", summary: USER_FACING.cancelledNoResult },
      now: DONE,
    });
    store.close();
    store = openTaskStore(dataDir);
    assert.equal(store.getRun("run-cancel")?.state, "cancelled");
    assert.equal(store.getTask("task-cancel")?.error?.message, USER_FACING.cancelledNoResult);
    store.close();

    store = openTaskStore(dataDir);
    store.insertQueued(
      queuedInput({
        runId: "run-int",
        clientRequestId: "client-int",
        tasks: [
          {
            taskId: "task-int",
            nodeId: "node-1",
            lane: "local",
            recipeId: RECIPE_TXT2IMG,
            recipeVersion: 1,
            fingerprintAtStart: FINGERPRINT,
          },
        ],
      }),
    );
    store.applyChanges({
      tasks: [
        {
          taskId: "task-int",
          state: "interrupted",
          error: { code: "RESTART_UNCERTAIN", message: USER_FACING.restartUncertain },
        },
      ],
      now: DONE,
    });
    store.close();
    store = openTaskStore(dataDir);
    const interrupted = store.getTask("task-int");
    assert.equal(interrupted?.state, "interrupted");
    assert.equal(interrupted?.error?.message, USER_FACING.restartUncertain);
    assert.equal(store.getRun("run-int")?.state, "running");
  } finally {
    store.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("同一事务：第二个任务不存在则整笔回滚，排队态仍完整", async () => {
  await withStore((store) => {
    store.insertQueued(
      queuedInput({
        tasks: [
          {
            taskId: "task-a",
            nodeId: "node-a",
            lane: "local",
            recipeId: RECIPE_TXT2IMG,
            recipeVersion: 1,
            fingerprintAtStart: FINGERPRINT,
          },
          {
            taskId: "task-b",
            nodeId: "node-b",
            lane: "local",
            recipeId: RECIPE_TXT2IMG,
            recipeVersion: 1,
            fingerprintAtStart: FINGERPRINT,
          },
        ],
      }),
    );
    assert.throws(
      () =>
        store.applyChanges({
          tasks: [
            { taskId: "task-a", state: "running" },
            { taskId: "missing-task", state: "running" },
          ],
          events: [{ type: "task.running", runId: "run-1", taskId: "task-a" }],
        }),
      (err: unknown) => err instanceof TaskStoreError && err.code === "NOT_FOUND",
    );
    const snap = store.getRun("run-1");
    assert.ok(snap);
    assert.equal(snap.tasks[0]?.state, "queued");
    assert.equal(snap.tasks[1]?.state, "queued");
    const types = store.listEvents("run-1").map((event: RunEvent) => event.type);
    assert.equal(types.includes("task.running"), false);
  });
});

test("close 释放文件后可删 dataDir；工程目录没有任务库", async () => {
  const root = await mkdtemp(join(tmpdir(), "canvas-taskstore-close-"));
  const dataDir = join(root, "data");
  const projectDir = join(root, "project");
  await mkdir(dataDir, { recursive: true });
  await mkdir(projectDir, { recursive: true });
  const store = openTaskStore(dataDir);
  store.insertQueued(queuedInput());
  assert.equal(existsSync(join(dataDir, EXECUTION_DB_FILENAME)), true);
  assert.equal(existsSync(join(projectDir, EXECUTION_DB_FILENAME)), false);
  store.close();
  await rm(root, { recursive: true, force: true });
  assert.equal(existsSync(dataDir), false);
});
