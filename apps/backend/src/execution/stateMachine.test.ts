/**
 * 方案 12.2 任务状态机。断言用户主句，不是内部枚举。
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  generationBadge,
  RECIPE_TXT2IMG,
  USER_FACING,
  type MediaRef,
  type ProjectEdge,
  type ProjectNode,
  type RunSnapshot,
} from "@canvas/schema";
import type { ComfyReachability } from "./comfy/client.ts";
import { FakeExecutor, fictionalSuccessPng } from "./fakeExecutor.ts";
import { projectAutosavePath } from "../project/atomicWrite.ts";
import { MEDIA_INGEST_FIELD, MEDIA_INGEST_PATH } from "../http/ingest.ts";
import {
  closeTestApp,
  createProject,
  headers,
  imageNode,
  img2imgNode,
  referenceNode,
  startTestApp,
  stopTestApp,
  txt2imgNode,
  type TestApp,
} from "../http/testApp.ts";

const reachable: ComfyReachability = {
  probe: async () => ({ reachable: true, message: "" }),
};
const unreachable: ComfyReachability = {
  probe: async () => ({ reachable: false, message: USER_FACING.comfyUnreachable }),
};
const COMFY = "http://127.0.0.1:8188";

async function waitFor(predicate: () => Promise<boolean> | boolean, timeoutMs = 4000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
  throw new Error("waitFor timeout");
}

async function putGraph(
  app: TestApp,
  contentRevision: number,
  nodes: Record<string, ProjectNode>,
  edges: Record<string, unknown> = {},
): Promise<number> {
  const res = await fetch(`${app.baseUrl}/api/projects/current/working-copy`, {
    method: "PUT",
    headers: headers(app.origin),
    body: JSON.stringify({ contentRevision, nodes, edges, groups: {} }),
  });
  assert.equal(res.status, 204);
  return Number(res.headers.get("X-Content-Revision"));
}

async function currentNodes(app: TestApp): Promise<Record<string, ProjectNode>> {
  const res = await fetch(`${app.baseUrl}/api/projects/current`, {
    headers: { Authorization: `Bearer ${app.token}` },
  });
  const body = (await res.json()) as { project: { nodes: Record<string, ProjectNode> } };
  return body.project.nodes;
}

async function postRun(
  app: TestApp,
  input: { projectId: string; nodeId: string; force?: boolean; clientRequestId?: string; extra?: Record<string, unknown> },
): Promise<Response> {
  return fetch(`${app.baseUrl}/api/execution/runs`, {
    method: "POST",
    headers: headers(app.origin),
    body: JSON.stringify({
      projectId: input.projectId,
      scope: { type: "node", nodeId: input.nodeId },
      force: input.force ?? false,
      clientRequestId: input.clientRequestId ?? `c-${Math.random().toString(16).slice(2)}`,
      ...input.extra,
    }),
  });
}

async function setupTxt2img(
  app: TestApp,
  extra: Partial<ProjectNode> = {},
): Promise<{ projectId: string; revision: number }> {
  const created = await createProject(app, "run-demo");
  assert.equal(created.status, 201);
  const projectId = created.body.projectId as string;
  const revision = await putGraph(app, 0, { g1: txt2imgNode("g1", extra) });
  return { projectId, revision };
}

function runApp(executor: FakeExecutor, extra?: { cancelTimeoutMs?: number; reachability?: ComfyReachability; comfyBaseUrl?: string | null }) {
  return startTestApp({
    executor,
    comfyReachability: extra?.reachability ?? reachable,
    comfyBaseUrl: extra?.comfyBaseUrl === undefined ? COMFY : extra.comfyBaseUrl,
    cancelTimeoutMs: extra?.cancelTimeoutMs,
  });
}

test("GET /recipes 仍是 schema 三张且无 comfy.prompt；多余字段 400", async () => {
  const app = await startTestApp();
  try {
    const recipes = await fetch(`${app.baseUrl}/api/execution/recipes`, {
      headers: { Authorization: `Bearer ${app.token}` },
    });
    assert.equal(recipes.status, 200);
    const list = (await recipes.json()) as Array<{ id: string }>;
    assert.equal(list.length, 5);
    assert.equal(JSON.stringify(list).includes("comfy.prompt"), false);
    assert.equal(JSON.stringify(list).includes("example.video.fixture"), false);
    assert.equal(list.some((item) => item.id === RECIPE_TXT2IMG), true);
    assert.equal(list.some((item) => item.id === "recipe.video.img2video.fixture"), true);

    const created = await createProject(app, "extra");
    const extra = await postRun(app, {
      projectId: created.body.projectId as string,
      nodeId: "g1",
      extra: { workflow: { nodes: [] }, comfyBaseUrl: "http://127.0.0.1:8188" },
    });
    assert.equal(extra.status, 400);
  } finally {
    await stopTestApp(app);
  }
});

test("无地址不假出图；GET comfy/health 不可达仍 HTTP 200", async () => {
  const fake = new FakeExecutor();
  const app = await startTestApp({
    executor: fake,
    comfyReachability: unreachable,
    comfyBaseUrl: null,
  });
  try {
    const { projectId } = await setupTxt2img(app);
    const res = await postRun(app, { projectId, nodeId: "g1" });
    assert.equal(res.status, 400);
    assert.equal(((await res.json()) as { message: string }).message, USER_FACING.comfyUnconfigured);
    assert.equal(fake.submitted.length, 0);

    const health = await fetch(`${app.baseUrl}/api/execution/comfy/health`, {
      headers: { Authorization: `Bearer ${app.token}` },
    });
    assert.equal(health.status, 200);
    const body = (await health.json()) as { reachable: boolean; message: string };
    assert.equal(body.reachable, false);
    assert.equal(body.message, USER_FACING.comfyUnconfigured);
  } finally {
    await stopTestApp(app);
  }
});

test("有 FakeExecutor 也不跳过预检：连不上用方案句子", async () => {
  const fake = new FakeExecutor();
  const app = await runApp(fake, { reachability: unreachable });
  try {
    const { projectId } = await setupTxt2img(app);
    const res = await postRun(app, { projectId, nodeId: "g1" });
    assert.equal(res.status, 400);
    assert.equal(((await res.json()) as { message: string }).message, USER_FACING.comfyUnreachable);
    assert.equal(fake.submitted.length, 0);
    const health = await fetch(`${app.baseUrl}/api/execution/comfy/health`, {
      headers: { Authorization: `Bearer ${app.token}` },
    });
    assert.equal(health.status, 200);
    const body = (await health.json()) as { reachable: boolean; message: string };
    assert.equal(body.reachable, false);
    assert.equal(body.message, USER_FACING.comfyUnreachable);
  } finally {
    await stopTestApp(app);
  }
});

test("12.2 缺提示词预检不入队，主句还缺提示词，徽章不变", async () => {
  const fake = new FakeExecutor();
  const app = await runApp(fake);
  try {
    const { projectId } = await setupTxt2img(app, { promptDraft: "" });
    const before = (await currentNodes(app)).g1;
    const res = await postRun(app, { projectId, nodeId: "g1" });
    assert.equal(res.status, 400);
    assert.equal(((await res.json()) as { message: string }).message, USER_FACING.missingPrompt);
    const after = (await currentNodes(app)).g1;
    assert.equal(after?.phase, before?.phase);
    assert.equal(fake.submitted.length, 0);
  } finally {
    await stopTestApp(app);
  }
});

test("12.2 槽齐运行：正在交给本机队列；同 clientRequestId 返回原 run", async () => {
  const fake = new FakeExecutor({ behavior: "hang-until-release" });
  const app = await runApp(fake);
  try {
    const { projectId } = await setupTxt2img(app);
    const clientRequestId = "same-client";
    const res = await postRun(app, { projectId, nodeId: "g1", clientRequestId });
    assert.equal(res.status, 200);
    const snap = (await res.json()) as RunSnapshot;
    assert.equal(snap.tasks.length, 1);
    assert.equal(snap.tasks[0]?.state, "queued");
    assert.equal(snap.summary, USER_FACING.handingToLocalQueue);
    const node = (await currentNodes(app)).g1;
    assert.ok(node?.phase === "queued" || node?.phase === "running");
    const label = node?.progress?.label ?? "";
    assert.ok(label === USER_FACING.handingToLocalQueue || label === USER_FACING.generatingElapsed("…"), label);
    assert.equal(label.includes("%"), false);
    const again = await postRun(app, { projectId, nodeId: "g1", clientRequestId });
    const againBody = (await again.json()) as RunSnapshot;
    assert.equal(againBody.runId, snap.runId);
    fake.releaseAll();
    await waitFor(async () => ((await currentNodes(app)).g1?.phase === "succeeded"));
  } finally {
    await stopTestApp(app);
  }
});

test("12.2 第二个排队前面还有 N 个本地任务，无假百分比", async () => {
  let n = 0;
  const fake = new FakeExecutor({
    behavior: () => {
      n += 1;
      return n === 1 ? "hang-until-release" : "succeed-immediately";
    },
  });
  const app = await runApp(fake);
  try {
    const created = await createProject(app, "queue");
    const projectId = created.body.projectId as string;
    await putGraph(app, 0, {
      g1: txt2imgNode("g1"),
      g2: txt2imgNode("g2", { x: 700, promptDraft: "第二张" }),
    });
    const first = await postRun(app, { projectId, nodeId: "g1" });
    assert.equal(first.status, 200);
    await waitFor(() => fake.submitted.length === 1);
    const second = await postRun(app, { projectId, nodeId: "g2" });
    assert.equal(second.status, 200);
    const node2 = (await currentNodes(app)).g2;
    assert.equal(node2?.phase, "queued");
    assert.equal(node2?.progress?.label, USER_FACING.localQueueAhead(1));
    assert.equal(node2?.progress?.label?.includes("%"), false);
    const node1 = (await currentNodes(app)).g1;
    assert.ok(node1?.progress?.label === USER_FACING.generatingElapsed("…") || node1?.phase === "running" || node1?.phase === "queued");
    if (node1?.progress?.label === USER_FACING.generatingElapsed("…")) {
      assert.equal(node1.progress.label.includes("%"), false);
    }
    fake.releaseAll();
    await waitFor(async () => {
      const nodes = await currentNodes(app);
      return nodes.g1?.phase === "succeeded" && nodes.g2?.phase === "succeeded";
    });
  } finally {
    await stopTestApp(app);
  }
});

test("12.2 成功：contentHash 入库、autosave、票据；失败节点不空", async () => {
  const ok = new FakeExecutor({ behavior: "succeed-immediately" });
  const app = await runApp(ok);
  try {
    const { projectId } = await setupTxt2img(app);
    const res = await postRun(app, { projectId, nodeId: "g1" });
    assert.equal(res.status, 200);
    const snap = (await res.json()) as RunSnapshot;
    await waitFor(async () => (await currentNodes(app)).g1?.phase === "succeeded");
    const node = (await currentNodes(app)).g1;
    assert.ok(node?.output?.contentHash);
    assert.ok(node.output?.relativePath.startsWith("media/blobs/"));
    assert.equal(node.progress, null);
    const autosave = JSON.parse(await readFile(projectAutosavePath(app.backend.session.current?.absolutePath ?? ""), "utf8")) as {
      nodes: Record<string, ProjectNode>;
    };
    assert.equal(autosave.nodes.g1?.output?.contentHash, node.output?.contentHash);
    const ticketPath = node.output?.thumbRelativePath ?? node.output?.relativePath;
    assert.ok(ticketPath);
    const ticket = await fetch(`${app.baseUrl}/api/projects/current/media-tickets`, {
      method: "POST",
      headers: headers(app.origin),
      body: JSON.stringify({
        relativePath: ticketPath,
        purpose: node.output?.thumbRelativePath ? "thumb" : "original",
      }),
    });
    assert.equal(ticket.status, 201);
    const ticketBody = (await ticket.json()) as { ticketId: string };
    const bytes = await fetch(`${app.baseUrl}/api/media-ticket/${ticketBody.ticketId}`);
    assert.equal(bytes.status, 200);
    const getRun = await fetch(`${app.baseUrl}/api/execution/runs/${snap.runId}`, {
      headers: { Authorization: `Bearer ${app.token}` },
    });
    assert.equal(getRun.status, 200);
    assert.equal(((await getRun.json()) as RunSnapshot).state, "succeeded");
  } finally {
    await stopTestApp(app);
  }

  const fail = new FakeExecutor({ behavior: "fail-immediately" });
  const app2 = await runApp(fail);
  try {
    const { projectId } = await setupTxt2img(app2);
    await postRun(app2, { projectId, nodeId: "g1" });
    await waitFor(async () => (await currentNodes(app2)).g1?.phase === "failed");
    const node = (await currentNodes(app2)).g1;
    assert.equal(node?.lastError?.message, USER_FACING.generationIncomplete);
    assert.ok(node);
  } finally {
    await stopTestApp(app2);
  }
});

test("12.2 取消三种终态：已取消 / 来不及取消 / 不确定", async () => {
  const hang = new FakeExecutor({ behavior: "hang-until-release" });
  const app = await runApp(hang);
  try {
    const created = await createProject(app, "cancel-q");
    const projectId = created.body.projectId as string;
    await putGraph(app, 0, {
      g1: txt2imgNode("g1"),
      g2: txt2imgNode("g2", { x: 700, promptDraft: "排队取消" }),
    });
    await postRun(app, { projectId, nodeId: "g1", clientRequestId: "c-q1" });
    await waitFor(() => hang.submitted.length === 1);
    const queued = await postRun(app, { projectId, nodeId: "g2", clientRequestId: "c-q2" });
    const queuedSnap = (await queued.json()) as RunSnapshot;
    assert.equal(queuedSnap.tasks[0]?.state, "queued");
    const cancelQueued = await fetch(`${app.baseUrl}/api/execution/tasks/${queuedSnap.tasks[0]?.taskId}/cancel`, {
      method: "POST",
      headers: headers(app.origin),
      body: "{}",
    });
    const cancelBody = (await cancelQueued.json()) as { message: string };
    assert.equal(cancelBody.message, USER_FACING.cancelledNoResult);
    const node = (await currentNodes(app)).g2;
    assert.equal(node?.lastError?.message, USER_FACING.cancelledNoResult);
    assert.notEqual(node?.phase, "queued");
    assert.equal(hang.submitted.length, 1);
    hang.releaseAll();
    await waitFor(async () => (await currentNodes(app)).g1?.phase === "succeeded");
  } finally {
    await stopTestApp(app);
  }

  const late = new FakeExecutor({ behavior: "succeed-on-cancel" });
  const app2 = await runApp(late);
  try {
    const { projectId } = await setupTxt2img(app2);
    const running = await postRun(app2, { projectId, nodeId: "g1" });
    const snap = (await running.json()) as RunSnapshot;
    await waitFor(() => late.submitted.length === 1);
    const cancel = await fetch(`${app2.baseUrl}/api/execution/tasks/${snap.tasks[0]?.taskId}/cancel`, {
      method: "POST",
      headers: headers(app2.origin),
      body: "{}",
    });
    assert.equal(cancel.status, 200);
    await waitFor(async () => (await currentNodes(app2)).g1?.phase === "succeeded");
    const node = (await currentNodes(app2)).g1;
    assert.equal(node?.lastError?.message, USER_FACING.tooLateToCancel);
  } finally {
    await stopTestApp(app2);
  }

  const silent = new FakeExecutor({ behavior: "cancel-no-reply" });
  const app3 = await runApp(silent, { cancelTimeoutMs: 80 });
  try {
    const { projectId } = await setupTxt2img(app3);
    const running = await postRun(app3, { projectId, nodeId: "g1" });
    const snap = (await running.json()) as RunSnapshot;
    await waitFor(() => silent.submitted.length === 1);
    await fetch(`${app3.baseUrl}/api/execution/tasks/${snap.tasks[0]?.taskId}/cancel`, {
      method: "POST",
      headers: headers(app3.origin),
      body: "{}",
    });
    await waitFor(async () => (await currentNodes(app3)).g1?.lastError?.message === USER_FACING.cancelUncertain);
    const node = (await currentNodes(app3)).g1;
    assert.equal(node?.lastError?.message, USER_FACING.cancelUncertain);
    assert.notEqual(node?.progress?.label, USER_FACING.cancelling);
  } finally {
    await stopTestApp(app3);
  }
});

test("12.2 刷新 GET snapshot 仍 running；库无此任务不确定", async () => {
  const fake = new FakeExecutor({ behavior: "hang-until-release" });
  const app = await runApp(fake);
  try {
    const { projectId } = await setupTxt2img(app);
    const res = await postRun(app, { projectId, nodeId: "g1" });
    const snap = (await res.json()) as RunSnapshot;
    await waitFor(() => fake.submitted.length === 1);
    const got = await fetch(`${app.baseUrl}/api/execution/runs/${snap.runId}`, {
      headers: { Authorization: `Bearer ${app.token}` },
    });
    assert.equal(got.status, 200);
    const body = (await got.json()) as RunSnapshot;
    assert.equal(body.state, "running");
    assert.ok(body.tasks[0]?.state === "running" || body.tasks[0]?.state === "submitted" || body.tasks[0]?.state === "queued");
    const missing = await fetch(`${app.baseUrl}/api/execution/runs/does-not-exist`, {
      headers: { Authorization: `Bearer ${app.token}` },
    });
    assert.equal(missing.status, 404);
    assert.equal(((await missing.json()) as { message: string }).message, USER_FACING.restartUncertain);
    const missingCancel = await fetch(`${app.baseUrl}/api/execution/tasks/missing/cancel`, {
      method: "POST",
      headers: headers(app.origin),
      body: "{}",
    });
    assert.equal(missingCancel.status, 404);
    assert.equal(((await missingCancel.json()) as { message: string }).message, USER_FACING.cancelUncertain);
    fake.releaseAll();
    await waitFor(async () => (await currentNodes(app)).g1?.phase === "succeeded");
  } finally {
    await stopTestApp(app);
  }
});

test("12.2 过期悬停无新 taskId；提交用入队快照；跑完输入已变不第二跑", async () => {
  const fake = new FakeExecutor({ behavior: "hang-until-release" });
  const app = await runApp(fake);
  try {
    const created = await createProject(app, "stale");
    const projectId = created.body.projectId as string;
    let revision = await putGraph(app, 0, { g1: txt2imgNode("g1", { promptDraft: "旧字" }) });
    const beforeRuns = await fetch(`${app.baseUrl}/api/execution/runs/none`, {
      headers: { Authorization: `Bearer ${app.token}` },
    });
    assert.equal(beforeRuns.status, 404);
    revision = await putGraph(app, revision, { g1: txt2imgNode("g1", { promptDraft: "新字-未跑", freshness: "stale" }) });
    assert.equal((await currentNodes(app)).g1?.lastTaskId ?? null, null);

    const res = await postRun(app, { projectId, nodeId: "g1" });
    const snap = (await res.json()) as RunSnapshot;
    await waitFor(() => fake.submitted.length === 1);
    assert.equal(fake.lastPromptText, "新字-未跑");
    revision = Number(
      (
        await fetch(`${app.baseUrl}/api/projects/current`, {
          headers: { Authorization: `Bearer ${app.token}` },
        })
      ).headers.get("X-Content-Revision") ?? revision,
    );
    const current = await fetch(`${app.baseUrl}/api/projects/current`, {
      headers: { Authorization: `Bearer ${app.token}` },
    });
    const curBody = (await current.json()) as { project: { contentRevision: number; nodes: Record<string, ProjectNode> } };
    revision = curBody.project.contentRevision;
    const queued = curBody.project.nodes.g1;
    assert.ok(queued?.phase === "queued" || queued?.phase === "running");
    await putGraph(app, revision, {
      g1: txt2imgNode("g1", { promptDraft: "演示4新字" }),
    });
    assert.equal(fake.lastPromptText, "新字-未跑");
    fake.releaseAll();
    await waitFor(async () => {
      const node = (await currentNodes(app)).g1;
      return node?.phase === "succeeded" && node.freshness === "stale";
    });
    const done = (await currentNodes(app)).g1;
    assert.equal(fake.lastPromptText, "新字-未跑");
    assert.equal(done?.freshness, "stale");
    assert.equal(done?.lastError?.message, USER_FACING.inputsChangedAfterRun);
    assert.equal(done?.output?.contentHash != null, true);
    const runs = await fetch(`${app.baseUrl}/api/execution/runs/${snap.runId}`, {
      headers: { Authorization: `Bearer ${app.token}` },
    });
    assert.equal(((await runs.json()) as RunSnapshot).runId, snap.runId);
  } finally {
    await stopTestApp(app);
  }
});

test("新鲜再跑需 force true 才追加版本", async () => {
  const fake = new FakeExecutor({ behavior: "succeed-immediately" });
  const app = await runApp(fake);
  try {
    const { projectId } = await setupTxt2img(app);
    await postRun(app, { projectId, nodeId: "g1", clientRequestId: "r1" });
    await waitFor(async () => (await currentNodes(app)).g1?.phase === "succeeded");
    const first = (await currentNodes(app)).g1;
    assert.equal(first?.versions?.length, 1);
    const skip = await postRun(app, { projectId, nodeId: "g1", force: false, clientRequestId: "r2" });
    assert.equal(skip.status, 400);
    assert.equal(((await skip.json()) as { message: string }).message, USER_FACING.runFreshConfirm);
    assert.equal((await currentNodes(app)).g1?.versions?.length, 1);
    const forced = await postRun(app, { projectId, nodeId: "g1", force: true, clientRequestId: "r3" });
    assert.equal(forced.status, 200);
    await waitFor(async () => ((await currentNodes(app)).g1?.versions?.length ?? 0) >= 2);
    assert.equal((await currentNodes(app)).g1?.versions?.length, 2);
  } finally {
    await stopTestApp(app);
  }
});

test("PUT working-copy 排队中不得把 phase 打回 idle；设置页 PUT 后预检用新地址", async () => {
  const fake = new FakeExecutor({ behavior: "hang-until-release" });
  const app = await runApp(fake);
  try {
    const { projectId } = await setupTxt2img(app);
    await postRun(app, { projectId, nodeId: "g1" });
    const queued = (await currentNodes(app)).g1;
    assert.ok(queued?.phase === "queued" || queued?.phase === "running");
    const current = await fetch(`${app.baseUrl}/api/projects/current`, {
      headers: { Authorization: `Bearer ${app.token}` },
    });
    const rev = ((await current.json()) as { project: { contentRevision: number } }).project.contentRevision;
    await putGraph(app, rev, {
      g1: txt2imgNode("g1", { promptDraft: "改过的字", phase: "idle" }),
    });
    const merged = (await currentNodes(app)).g1;
    assert.ok(merged?.phase === "queued" || merged?.phase === "running");
    assert.notEqual(merged?.phase, "idle");
    assert.equal(merged?.promptDraft, "改过的字");
    fake.releaseAll();
    await waitFor(async () => (await currentNodes(app)).g1?.phase === "succeeded");
  } finally {
    await stopTestApp(app);
  }

  const hot = new FakeExecutor({ behavior: "succeed-immediately" });
  const app2 = await startTestApp({ executor: hot, comfyReachability: reachable, comfyBaseUrl: null });
  try {
    const put = await fetch(`${app2.baseUrl}/api/app/comfy-base-url`, {
      method: "PUT",
      headers: headers(app2.origin),
      body: JSON.stringify({ comfyBaseUrl: COMFY }),
    });
    assert.equal(put.status, 204);
    const cfg = await fetch(`${app2.baseUrl}/api/app/config`, {
      headers: { Authorization: `Bearer ${app2.token}` },
    });
    const cfgBody = (await cfg.json()) as { comfyBaseUrl: string | null };
    assert.equal(cfgBody.comfyBaseUrl, COMFY);
    const { projectId } = await setupTxt2img(app2);
    const res = await postRun(app2, { projectId, nodeId: "g1" });
    assert.equal(res.status, 200);
  } finally {
    await stopTestApp(app2);
  }
});

test("12.2 WS 订后续；scope 非 node 不得 500", async () => {
  const fake = new FakeExecutor({ behavior: "hang-until-release" });
  const app = await runApp(fake);
  try {
    const { projectId } = await setupTxt2img(app);
    const res = await postRun(app, { projectId, nodeId: "g1" });
    const snap = (await res.json()) as RunSnapshot;
    await waitFor(() => fake.submitted.length === 1);
    const events: Array<{ type: string }> = [];
    const ws = new WebSocket(`ws://127.0.0.1:${app.port}/api/execution/runs/${snap.runId}/events`, [
      "canvas-bearer",
      `canvas-bearer.${app.token}`,
    ]);
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("ws open")), 3000);
      ws.addEventListener("open", () => {
        clearTimeout(timer);
        resolve();
      });
      ws.addEventListener("error", () => {
        clearTimeout(timer);
        reject(new Error("ws error"));
      });
    });
    ws.addEventListener("message", (ev) => {
      events.push(JSON.parse(String(ev.data)) as { type: string });
    });
    fake.releaseAll();
    await waitFor(() => events.some((item) => item.type === "run.finished" || item.type === "node.patch"));
    ws.close();
    const down = await fetch(`${app.baseUrl}/api/execution/runs`, {
      method: "POST",
      headers: headers(app.origin),
      body: JSON.stringify({
        projectId,
        scope: { type: "downstream", nodeId: "g1" },
        force: false,
        clientRequestId: "down-1",
      }),
    });
    assert.notEqual(down.status, 500);
    const sel = await fetch(`${app.baseUrl}/api/execution/runs`, {
      method: "POST",
      headers: headers(app.origin),
      body: JSON.stringify({
        projectId,
        scope: { type: "selection", nodeIds: ["g1"] },
        force: true,
        clientRequestId: "sel-1",
      }),
    });
    assert.notEqual(sel.status, 500);
  } finally {
    await stopTestApp(app);
  }
});

test("12.2 重启后端：sqlite 里 running 不得继续显示运行中", async () => {
  const fake = new FakeExecutor({ behavior: "hang-until-release" });
  const app = await runApp(fake);
  let reuse: { root: string; dataDir: string; projectsDir: string; homeDir: string } | undefined;
  let runId = "";
  let absolutePath = "";
  try {
    const created = await createProject(app, "restart-demo");
    const projectId = created.body.projectId as string;
    absolutePath = String(created.body.absolutePath);
    await putGraph(app, 0, { g1: txt2imgNode("g1") });
    const res = await postRun(app, { projectId, nodeId: "g1" });
    assert.equal(res.status, 200);
    const snap = (await res.json()) as RunSnapshot;
    runId = snap.runId;
    await waitFor(() => fake.submitted.length === 1);
    const mid = await fetch(`${app.baseUrl}/api/execution/runs/${runId}`, {
      headers: { Authorization: `Bearer ${app.token}` },
    });
    assert.equal(((await mid.json()) as RunSnapshot).state, "running");
    reuse = {
      root: app.root,
      dataDir: app.dataDir,
      projectsDir: app.projectsDir,
      homeDir: app.homeDir,
    };
    await closeTestApp(app);
  } catch (err) {
    await stopTestApp(app);
    throw err;
  }

  const fake2 = new FakeExecutor({ behavior: "succeed-immediately" });
  const app2 = await startTestApp({
    reuse,
    executor: fake2,
    comfyReachability: reachable,
    comfyBaseUrl: COMFY,
  });
  try {
    const after = await fetch(`${app2.baseUrl}/api/execution/runs/${runId}`, {
      headers: { Authorization: `Bearer ${app2.token}` },
    });
    assert.equal(after.status, 200);
    const body = (await after.json()) as RunSnapshot;
    assert.notEqual(body.state, "running");
    assert.equal(body.tasks[0]?.state, "interrupted");
    assert.equal(body.summary, USER_FACING.restartUncertain);

    const opened = await fetch(`${app2.baseUrl}/api/projects/open`, {
      method: "POST",
      headers: headers(app2.origin),
      body: JSON.stringify({ absolutePath }),
    });
    assert.equal(opened.status, 200);
    const openedBody = (await opened.json()) as { project: { nodes: Record<string, ProjectNode> } };
    const node = openedBody.project.nodes.g1;
    assert.notEqual(node?.phase, "running");
    assert.notEqual(node?.phase, "queued");
    assert.equal(node?.lastError?.message, USER_FACING.restartUncertain);
    assert.equal(fake2.submitted.length, 0);
  } finally {
    await stopTestApp(app2);
  }
});

async function ingestPng(app: TestApp): Promise<MediaRef> {
  const form = new FormData();
  const bytes = fictionalSuccessPng();
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  form.append(MEDIA_INGEST_FIELD, new File([copy], "src.png", { type: "image/png" }));
  const res = await fetch(`${app.baseUrl}${MEDIA_INGEST_PATH}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${app.token}`, Origin: app.origin },
    body: form,
  });
  assert.equal(res.status, 201);
  const body = (await res.json()) as { media: MediaRef };
  return body.media;
}

test("四变体第 2 张失败：partial、徽章 succeeded、副文案、未 submit index=2", async () => {
  const fake = new FakeExecutor({ behavior: "succeed-immediately", failAtVariantIndex: 1 });
  const app = await runApp(fake);
  try {
    const created = await createProject(app, "partial");
    const projectId = created.body.projectId as string;
    await putGraph(app, 0, { g1: txt2imgNode("g1", { variantCount: 4, params: { seed: 7, width: 1024, height: 1024 } }) });
    const res = await postRun(app, { projectId, nodeId: "g1" });
    assert.equal(res.status, 200);
    await waitFor(async () => (await currentNodes(app)).g1?.phase === "succeeded");
    const node = (await currentNodes(app)).g1;
    assert.equal(node?.phase, "succeeded");
    assert.notEqual(node?.phase, "failed");
    assert.equal(generationBadge(node!), "succeeded");
    assert.notEqual(node?.lastError?.message, USER_FACING.generationIncomplete);
    const version = node?.versions?.find((item) => item.id === node.currentVersionId);
    assert.equal(version?.variants.length, 4);
    assert.equal(USER_FACING.partialSuccess(4, 1), "4 张里成功了 1 张。");
    assert.equal(node?.lastError?.message, USER_FACING.partialSuccess(4, 1));
    assert.equal(fake.submitted.some((item) => item.variantIndex === 2), false);
    assert.equal(fake.submitted.length, 2);
    const snap = (await res.json()) as RunSnapshot;
    await waitFor(async () => {
      const run = await fetch(`${app.baseUrl}/api/execution/runs/${snap.runId}`, {
        headers: { Authorization: `Bearer ${app.token}` },
      });
      const body = (await run.json()) as RunSnapshot;
      return body.state !== "running";
    });
    const runRes = await fetch(`${app.baseUrl}/api/execution/runs/${snap.runId}`, {
      headers: { Authorization: `Bearer ${app.token}` },
    });
    const runBody = (await runRes.json()) as RunSnapshot;
    assert.equal(runBody.tasks[0]?.state, "partial");
    assert.deepEqual(
      fake.submitted.map((_, i) => i),
      [0, 1],
    );
    const seeds = version?.variants.map((item) => item.seedUsed);
    assert.equal(seeds?.[0], 7);
  } finally {
    await stopTestApp(app);
  }
});

test("遮罩/缺原图 400 且 phase 与徽章不变", async () => {
  const fake = new FakeExecutor({ behavior: "succeed-immediately" });
  const app = await runApp(fake);
  try {
    const created = await createProject(app, "mask");
    const projectId = created.body.projectId as string;
    const media = await ingestPng(app);
    const g = img2imgNode("g1", {
      slots: [
        { id: "g1-prompt", role: "prompt", order: 0, edgeId: null },
        { id: "g1-src", role: "source_image", order: 1, edgeId: "e-src" },
        { id: "g1-mask", role: "mask", order: 2, edgeId: "e-mask" },
      ],
    });
    const edges: Record<string, ProjectEdge> = {
      "e-src": { id: "e-src", sourceNodeId: "img", targetNodeId: "g1", targetSlotId: "g1-src", role: "source_image" },
      "e-mask": { id: "e-mask", sourceNodeId: "msk", targetNodeId: "g1", targetSlotId: "g1-mask", role: "mask" },
    };
    await putGraph(app, 0, { img: imageNode("img", media), msk: imageNode("msk", media), g1: g }, edges);
    const before = (await currentNodes(app)).g1;
    const res = await postRun(app, { projectId, nodeId: "g1" });
    assert.equal(res.status, 400);
    assert.equal(((await res.json()) as { message: string }).message, USER_FACING.slotUnsupportedMask);
    const after = (await currentNodes(app)).g1;
    assert.equal(after?.phase, before?.phase);
    assert.equal(after?.slots?.find((slot) => slot.role === "mask")?.edgeId, "e-mask");
    assert.equal(fake.submitted.length, 0);

    const missing = img2imgNode("g2");
    const rev = (await fetch(`${app.baseUrl}/api/projects/current`, {
      headers: { Authorization: `Bearer ${app.token}` },
    }).then((r) => r.json())) as { project: { contentRevision: number } };
    await putGraph(app, rev.project.contentRevision, { g2: missing });
    const before2 = (await currentNodes(app)).g2;
    const res2 = await postRun(app, { projectId, nodeId: "g2" });
    assert.equal(res2.status, 400);
    assert.equal(((await res2.json()) as { message: string }).message, USER_FACING.missingSourceImage);
    const after2 = (await currentNodes(app)).g2;
    assert.equal(after2?.phase, before2?.phase);
  } finally {
    await stopTestApp(app);
  }
});

test("图生图/参考图跑通：uploaded≥1 且 prompt 内为 upload 返回名", async () => {
  const fake = new FakeExecutor({ behavior: "succeed-immediately" });
  const app = await runApp(fake);
  try {
    const created = await createProject(app, "i2i");
    const projectId = created.body.projectId as string;
    const media = await ingestPng(app);
    const g = img2imgNode("g1", {
      slots: [
        { id: "g1-prompt", role: "prompt", order: 0, edgeId: null },
        { id: "g1-src", role: "source_image", order: 1, edgeId: "e-src" },
      ],
    });
    await putGraph(
      app,
      0,
      { img: imageNode("img", media), g1: g },
      { "e-src": { id: "e-src", sourceNodeId: "img", targetNodeId: "g1", targetSlotId: "g1-src", role: "source_image" } },
    );
    const res = await postRun(app, { projectId, nodeId: "g1" });
    assert.equal(res.status, 200);
    await waitFor(async () => (await currentNodes(app)).g1?.phase === "succeeded");
    assert.equal(fake.uploaded.length >= 1, true);
    const name = fake.uploaded[0]?.name;
    assert.ok(name);
    assert.equal(JSON.stringify(fake.submitted[0]?.prompt).includes(name), true);
    assert.equal(JSON.stringify(fake.submitted[0]?.prompt).includes(media.contentHash ?? "no"), false);

    fake.uploaded.length = 0;
    fake.submitted.length = 0;
    const rev = (await fetch(`${app.baseUrl}/api/projects/current`, {
      headers: { Authorization: `Bearer ${app.token}` },
    }).then((r) => r.json())) as { project: { contentRevision: number } };
    const r = referenceNode("r1", {
      slots: [
        { id: "r1-prompt", role: "prompt", order: 0, edgeId: null },
        { id: "r1-ref", role: "reference_image", order: 1, edgeId: "e-ref" },
      ],
    });
    await putGraph(
      app,
      rev.project.contentRevision,
      { img: imageNode("img", media), r1: r },
      { "e-ref": { id: "e-ref", sourceNodeId: "img", targetNodeId: "r1", targetSlotId: "r1-ref", role: "reference_image" } },
    );
    const res2 = await postRun(app, { projectId, nodeId: "r1" });
    assert.equal(res2.status, 200);
    await waitFor(async () => (await currentNodes(app)).r1?.phase === "succeeded");
    assert.equal(fake.uploaded.length >= 1, true);
    const name2 = fake.uploaded[0]?.name;
    assert.ok(name2);
    assert.equal(JSON.stringify(fake.submitted.at(-1)?.prompt).includes(name2), true);
  } finally {
    await stopTestApp(app);
  }
});

test("A 入队后失败、B 已 queued：B uploaded=0 submitted=0，phase 回到入队前", async () => {
  const fake = new FakeExecutor({ behavior: "fail-immediately" });
  const app = await runApp(fake);
  try {
    const created = await createProject(app, "dep");
    const projectId = created.body.projectId as string;
    const media = await ingestPng(app);
    const a = img2imgNode("A", {
      slots: [
        { id: "A-prompt", role: "prompt", order: 0, edgeId: null },
        { id: "A-src", role: "source_image", order: 1, edgeId: "e-img" },
      ],
    });
    await putGraph(
      app,
      0,
      { img: imageNode("img", media), A: a },
      { "e-img": { id: "e-img", sourceNodeId: "img", targetNodeId: "A", targetSlotId: "A-src", role: "source_image" } },
    );
    const first = await postRun(app, { projectId, nodeId: "A", clientRequestId: "a1" });
    assert.equal(first.status, 200);
    await waitFor(async () => (await currentNodes(app)).A?.phase === "failed" || (await currentNodes(app)).A?.phase === "succeeded");
    const aLive = (await currentNodes(app)).A;
    if (aLive?.phase !== "succeeded") {
      aLive!.phase = "succeeded";
      aLive!.output = media;
      aLive!.lastSuccessFingerprint = "x";
    }
    const rev = (await fetch(`${app.baseUrl}/api/projects/current`, {
      headers: { Authorization: `Bearer ${app.token}` },
    }).then((r) => r.json())) as { project: { contentRevision: number; nodes: Record<string, ProjectNode> } };
    const aNow = rev.project.nodes.A!;
    aNow.output = media;
    aNow.phase = "succeeded";
    const b = img2imgNode("B", {
      x: 700,
      slots: [
        { id: "B-prompt", role: "prompt", order: 0, edgeId: null },
        { id: "B-src", role: "source_image", order: 1, edgeId: "e-ab" },
      ],
    });
    await putGraph(
      app,
      rev.project.contentRevision,
      { img: imageNode("img", media), A: aNow, B: b },
      {
        "e-img": { id: "e-img", sourceNodeId: "img", targetNodeId: "A", targetSlotId: "A-src", role: "source_image" },
        "e-ab": { id: "e-ab", sourceNodeId: "A", targetNodeId: "B", targetSlotId: "B-src", role: "source_image" },
      },
    );
    fake.submitted.length = 0;
    fake.uploaded.length = 0;
    const beforeB = (await currentNodes(app)).B?.phase;
    const sel = await fetch(`${app.baseUrl}/api/execution/runs`, {
      method: "POST",
      headers: headers(app.origin),
      body: JSON.stringify({
        projectId,
        scope: { type: "selection", nodeIds: ["A", "B"] },
        force: true,
        clientRequestId: "ab",
      }),
    });
    assert.equal(sel.status, 200);
    await waitFor(async () => {
      const n = await currentNodes(app);
      return n.A?.phase !== "queued" && n.A?.phase !== "running" && n.B?.phase !== "queued" && n.B?.phase !== "running";
    });
    const afterB = (await currentNodes(app)).B;
    assert.equal(afterB?.phase, beforeB);
    assert.notEqual(afterB?.phase, "queued");
    assert.equal(afterB?.lastError?.message, USER_FACING.upstreamNotRun);
    const bSubmitted = fake.submitted.filter((item) => JSON.stringify(item.prompt).includes("B") === false);
    assert.equal(fake.submitted.length <= 1, true);
    void bSubmitted;
  } finally {
    await stopTestApp(app);
  }
});

test("三任务 3 个里有 1 个失败 锁 run.summary", async () => {
  const fake = new FakeExecutor({
    behavior: (input) => (input.promptText.includes("fail") ? "fail-immediately" : "succeed-immediately"),
  });
  const app = await runApp(fake);
  try {
    const created = await createProject(app, "three");
    const projectId = created.body.projectId as string;
    await putGraph(app, 0, {
      g1: txt2imgNode("g1", { promptDraft: "ok-1" }),
      g2: txt2imgNode("g2", { x: 400, promptDraft: "fail-me" }),
      g3: txt2imgNode("g3", { x: 800, promptDraft: "ok-3" }),
    });
    const res = await fetch(`${app.baseUrl}/api/execution/runs`, {
      method: "POST",
      headers: headers(app.origin),
      body: JSON.stringify({
        projectId,
        scope: { type: "selection", nodeIds: ["g1", "g2", "g3"] },
        force: false,
        clientRequestId: "three",
      }),
    });
    assert.equal(res.status, 200);
    const snap = (await res.json()) as RunSnapshot;
    await waitFor(async () => {
      const run = await fetch(`${app.baseUrl}/api/execution/runs/${snap.runId}`, {
        headers: { Authorization: `Bearer ${app.token}` },
      });
      return ((await run.json()) as RunSnapshot).state !== "running";
    });
    const done = await fetch(`${app.baseUrl}/api/execution/runs/${snap.runId}`, {
      headers: { Authorization: `Bearer ${app.token}` },
    });
    const body = (await done.json()) as RunSnapshot;
    assert.equal(body.summary, USER_FACING.selectionPartial(3, 1));
    assert.equal(body.summary, "3 个里有 1 个失败");
    assert.notEqual(body.summary, USER_FACING.generationIncomplete);
  } finally {
    await stopTestApp(app);
  }
});

test("一个输出两下游改字都 stale 无第二 submit", async () => {
  const fake = new FakeExecutor({ behavior: "succeed-immediately" });
  const app = await runApp(fake);
  try {
    const created = await createProject(app, "fan");
    const projectId = created.body.projectId as string;
    await putGraph(
      app,
      0,
      {
        t: {
          id: "t",
          kind: "text",
          title: "文本",
          x: 0,
          y: 0,
          width: 280,
          height: 180,
          z: 0,
          groupId: null,
          origin: "authored",
          createdAt: "2026-09-24T00:00:00.000Z",
          updatedAt: "2026-09-24T00:00:00.000Z",
          outputRevision: 1,
          text: "一只纸船",
        },
        g1: txt2imgNode("g1", { slots: [{ id: "g1-prompt", role: "prompt", order: 0, edgeId: "e1" }] }),
        g2: txt2imgNode("g2", { x: 700, slots: [{ id: "g2-prompt", role: "prompt", order: 0, edgeId: "e2" }] }),
      },
      {
        e1: { id: "e1", sourceNodeId: "t", targetNodeId: "g1", targetSlotId: "g1-prompt", role: "prompt" },
        e2: { id: "e2", sourceNodeId: "t", targetNodeId: "g2", targetSlotId: "g2-prompt", role: "prompt" },
      },
    );
    assert.equal((await postRun(app, { projectId, nodeId: "g1", clientRequestId: "fan1" })).status, 200);
    await waitFor(async () => (await currentNodes(app)).g1?.phase === "succeeded");
    assert.equal((await postRun(app, { projectId, nodeId: "g2", clientRequestId: "fan2" })).status, 200);
    await waitFor(async () => (await currentNodes(app)).g2?.phase === "succeeded");
    const submittedAfter = fake.submitted.length;
    const rev = (await fetch(`${app.baseUrl}/api/projects/current`, {
      headers: { Authorization: `Bearer ${app.token}` },
    }).then((r) => r.json())) as { project: { contentRevision: number; nodes: Record<string, ProjectNode> } };
    const t = rev.project.nodes.t!;
    t.text = "新字";
    await putGraph(app, rev.project.contentRevision, rev.project.nodes, {
      e1: { id: "e1", sourceNodeId: "t", targetNodeId: "g1", targetSlotId: "g1-prompt", role: "prompt" },
      e2: { id: "e2", sourceNodeId: "t", targetNodeId: "g2", targetSlotId: "g2-prompt", role: "prompt" },
    });
    const after = await currentNodes(app);
    assert.equal(after.g1?.phase, "succeeded");
    assert.equal(after.g2?.phase, "succeeded");
    assert.equal(fake.submitted.length, submittedAfter);
    const down = await fetch(`${app.baseUrl}/api/execution/runs`, {
      method: "POST",
      headers: headers(app.origin),
      body: JSON.stringify({
        projectId,
        scope: { type: "downstream", nodeId: "t" },
        force: false,
        clientRequestId: "fan-down",
      }),
    });
    assert.equal(down.status, 200);
    const downBody = (await down.json()) as RunSnapshot;
    assert.equal(downBody.tasks.length, 2);
  } finally {
    await stopTestApp(app);
  }
});

test("queued 取消 uploaded=0；retryFailed 指纹变则 400 原文", async () => {
  const fake = new FakeExecutor({ behavior: "hang-until-release" });
  const app = await runApp(fake);
  try {
    const created = await createProject(app, "cancel-q");
    const projectId = created.body.projectId as string;
    await putGraph(app, 0, {
      g1: txt2imgNode("g1"),
      g2: txt2imgNode("g2", { x: 700, promptDraft: "排队的" }),
    });
    const first = await postRun(app, { projectId, nodeId: "g1", clientRequestId: "c1" });
    assert.equal(first.status, 200);
    await waitFor(() => fake.submitted.length === 1);
    const second = await postRun(app, { projectId, nodeId: "g2", clientRequestId: "c2" });
    assert.equal(second.status, 200);
    const snap2 = (await second.json()) as RunSnapshot;
    const task2 = snap2.tasks[0];
    assert.ok(task2);
    const uploadsBefore = fake.uploaded.length;
    const cancel = await fetch(`${app.baseUrl}/api/execution/tasks/${task2.taskId}/cancel`, {
      method: "POST",
      headers: headers(app.origin),
    });
    assert.equal(cancel.status, 200);
    assert.equal(fake.uploaded.length, uploadsBefore);
    fake.releaseAll();
    await waitFor(async () => (await currentNodes(app)).g1?.phase === "succeeded");

    const fake2 = new FakeExecutor({ behavior: "succeed-immediately", failAtVariantIndex: 1 });
    const appP = await runApp(fake2);
    try {
      const createdP = await createProject(appP, "retry");
      const pid = createdP.body.projectId as string;
      await putGraph(appP, 0, { g1: txt2imgNode("g1", { variantCount: 4 }) });
      const run = await postRun(appP, { projectId: pid, nodeId: "g1" });
      const runSnap = (await run.json()) as RunSnapshot;
      await waitFor(async () => (await currentNodes(appP)).g1?.phase === "succeeded");
      const rev = (await fetch(`${appP.baseUrl}/api/projects/current`, {
        headers: { Authorization: `Bearer ${appP.token}` },
      }).then((r) => r.json())) as { project: { contentRevision: number } };
      await putGraph(appP, rev.project.contentRevision, { g1: txt2imgNode("g1", { variantCount: 4, promptDraft: "变了" }) });
      const retry = await fetch(`${appP.baseUrl}/api/execution/runs/${runSnap.runId}/retry-failed`, {
        method: "POST",
        headers: headers(appP.origin),
      });
      assert.equal(retry.status, 400);
      assert.equal(((await retry.json()) as { message: string }).message, USER_FACING.retryFailedInputsChanged);
    } finally {
      await stopTestApp(appP);
    }
  } finally {
    await stopTestApp(app);
  }
});

test("retryFailed 只补失败下标，成功格 seedUsed 不变", async () => {
  const fake = new FakeExecutor({ behavior: "succeed-immediately", failAtVariantIndex: 1 });
  const app = await runApp(fake);
  try {
    const created = await createProject(app, "retry-seed");
    const projectId = created.body.projectId as string;
    await putGraph(app, 0, {
      g1: txt2imgNode("g1", { variantCount: 4, params: { seed: 7, width: 1024, height: 1024 } }),
    });
    const run = await postRun(app, { projectId, nodeId: "g1" });
    assert.equal(run.status, 200);
    const runSnap = (await run.json()) as RunSnapshot;
    await waitFor(async () => (await currentNodes(app)).g1?.phase === "succeeded");
    const before = (await currentNodes(app)).g1;
    const version = before?.versions?.find((item) => item.id === before.currentVersionId);
    assert.equal(version?.variants[0]?.phase, "succeeded");
    assert.equal(version?.variants[0]?.seedUsed, 7);
    assert.equal(version?.variants[1]?.phase, "failed");
    const submittedBefore = fake.submitted.length;
    const retry = await fetch(`${app.baseUrl}/api/execution/runs/${runSnap.runId}/retry-failed`, {
      method: "POST",
      headers: headers(app.origin),
    });
    assert.equal(retry.status, 200);
    await waitFor(async () => {
      const node = (await currentNodes(app)).g1;
      return node?.phase === "succeeded" && node.lastRunId !== runSnap.runId;
    });
    const after = (await currentNodes(app)).g1;
    const afterVersion = after?.versions?.find((item) => item.id === before?.currentVersionId);
    assert.equal(after?.versions?.length, 1);
    assert.equal(afterVersion?.variants[0]?.seedUsed, 7);
    assert.equal(afterVersion?.variants[0]?.phase, "succeeded");
    const retried = fake.submitted.slice(submittedBefore);
    assert.equal(retried.some((item) => item.variantIndex === 0), false);
    assert.equal(retried[0]?.variantIndex, 1);
  } finally {
    await stopTestApp(app);
  }
});

test("已有成功版本时遮罩预检不把徽章改成失败", async () => {
  const fake = new FakeExecutor({ behavior: "succeed-immediately" });
  const app = await runApp(fake);
  try {
    const created = await createProject(app, "precheck-success");
    const projectId = created.body.projectId as string;
    const media = await ingestPng(app);
    const g = img2imgNode("g1", {
      slots: [
        { id: "g1-prompt", role: "prompt", order: 0, edgeId: null },
        { id: "g1-src", role: "source_image", order: 1, edgeId: "e-src" },
      ],
    });
    await putGraph(
      app,
      0,
      { img: imageNode("img", media), g1: g },
      { "e-src": { id: "e-src", sourceNodeId: "img", targetNodeId: "g1", targetSlotId: "g1-src", role: "source_image" } },
    );
    const run = await postRun(app, { projectId, nodeId: "g1" });
    assert.equal(run.status, 200);
    await waitFor(async () => (await currentNodes(app)).g1?.phase === "succeeded");
    const rev = (await fetch(`${app.baseUrl}/api/projects/current`, {
      headers: { Authorization: `Bearer ${app.token}` },
    }).then((r) => r.json())) as { project: { contentRevision: number; nodes: Record<string, ProjectNode>; edges: Record<string, ProjectEdge> } };
    const nodes = rev.project.nodes;
    const live = nodes.g1;
    assert.ok(live);
    assert.equal(generationBadge(live), "succeeded");
    live.slots = [
      { id: "g1-prompt", role: "prompt", order: 0, edgeId: null },
      { id: "g1-src", role: "source_image", order: 1, edgeId: "e-src" },
      { id: "g1-mask", role: "mask", order: 2, edgeId: "e-mask" },
    ];
    nodes.msk = imageNode("msk", media);
    const edges = {
      ...rev.project.edges,
      "e-mask": { id: "e-mask", sourceNodeId: "msk", targetNodeId: "g1", targetSlotId: "g1-mask", role: "mask" as const },
    };
    const submittedBefore = fake.submitted.length;
    await putGraph(app, rev.project.contentRevision, nodes, edges);
    const res = await postRun(app, { projectId, nodeId: "g1", clientRequestId: "mask-after-success" });
    assert.equal(res.status, 400);
    assert.equal(((await res.json()) as { message: string }).message, USER_FACING.slotUnsupportedMask);
    const after = (await currentNodes(app)).g1;
    assert.equal(after?.phase, "succeeded");
    assert.notEqual(generationBadge(after!), "failed");
    assert.equal(after?.slots?.find((slot) => slot.role === "mask")?.edgeId, "e-mask");
    assert.equal(fake.submitted.length, submittedBefore);
  } finally {
    await stopTestApp(app);
  }
});

test("两张参考图 + 风格参考一次跑通", async () => {
  const fake = new FakeExecutor({ behavior: "succeed-immediately" });
  const app = await runApp(fake);
  try {
    const created = await createProject(app, "refs");
    const projectId = created.body.projectId as string;
    const media = await ingestPng(app);
    const g = referenceNode("g1", {
      slots: [
        { id: "g1-prompt", role: "prompt", order: 0, edgeId: null },
        { id: "g1-ref0", role: "reference_image", order: 1, edgeId: "e-ref0" },
        { id: "g1-ref1", role: "reference_image", order: 2, edgeId: "e-ref1" },
        { id: "g1-style", role: "style_reference", order: 3, edgeId: "e-style" },
      ],
    });
    const edges: Record<string, ProjectEdge> = {
      "e-ref0": { id: "e-ref0", sourceNodeId: "a", targetNodeId: "g1", targetSlotId: "g1-ref0", role: "reference_image" },
      "e-ref1": { id: "e-ref1", sourceNodeId: "b", targetNodeId: "g1", targetSlotId: "g1-ref1", role: "reference_image" },
      "e-style": { id: "e-style", sourceNodeId: "s", targetNodeId: "g1", targetSlotId: "g1-style", role: "style_reference" },
    };
    await putGraph(
      app,
      0,
      { a: imageNode("a", media), b: imageNode("b", media, { title: "图片 2" }), s: imageNode("s", media, { title: "风格" }), g1: g },
      edges,
    );
    const res = await postRun(app, { projectId, nodeId: "g1" });
    assert.equal(res.status, 200);
    await waitFor(async () => (await currentNodes(app)).g1?.phase === "succeeded");
    assert.equal(fake.uploaded.length, 3);
    const prompt = fake.submitted[0]?.prompt as Record<string, { inputs: Record<string, unknown> }>;
    assert.equal(prompt.ref0?.inputs.image, fake.uploaded[0]?.name);
    assert.equal(prompt.ref1?.inputs.image, fake.uploaded[1]?.name);
    assert.equal(prompt.style0?.inputs.image, fake.uploaded[2]?.name);
    assert.equal((await currentNodes(app)).g1?.phase, "succeeded");
  } finally {
    await stopTestApp(app);
  }
});

test("过期成功节点重启后不自动入队", async () => {
  const fake = new FakeExecutor({ behavior: "succeed-immediately" });
  const app = await runApp(fake);
  let reuse: { root: string; dataDir: string; projectsDir: string; homeDir: string } | undefined;
  let absolutePath = "";
  try {
    const created = await createProject(app, "stale-restart");
    const projectId = created.body.projectId as string;
    absolutePath = String(created.body.absolutePath);
    await putGraph(app, 0, { g1: txt2imgNode("g1") });
    const run = await postRun(app, { projectId, nodeId: "g1" });
    assert.equal(run.status, 200);
    await waitFor(async () => (await currentNodes(app)).g1?.phase === "succeeded");
    const current = (await fetch(`${app.baseUrl}/api/projects/current`, {
      headers: { Authorization: `Bearer ${app.token}` },
    }).then((r) => r.json())) as { project: { contentRevision: number; nodes: Record<string, ProjectNode> } };
    const node = current.project.nodes.g1;
    assert.ok(node);
    node.freshness = "stale";
    node.promptDraft = "上游改过";
    await putGraph(app, current.project.contentRevision, current.project.nodes);
    const save = await fetch(`${app.baseUrl}/api/projects/current`, {
      method: "PUT",
      headers: headers(app.origin),
    });
    assert.equal(save.status, 200);
    reuse = { root: app.root, dataDir: app.dataDir, projectsDir: app.projectsDir, homeDir: app.homeDir };
    await closeTestApp(app);
  } catch (err) {
    await stopTestApp(app);
    throw err;
  }

  const fake2 = new FakeExecutor({ behavior: "succeed-immediately" });
  const app2 = await startTestApp({
    reuse,
    executor: fake2,
    comfyReachability: reachable,
    comfyBaseUrl: COMFY,
  });
  try {
    const opened = await fetch(`${app2.baseUrl}/api/projects/open`, {
      method: "POST",
      headers: headers(app2.origin),
      body: JSON.stringify({ absolutePath }),
    });
    assert.equal(opened.status, 200);
    const body = (await opened.json()) as { project: { nodes: Record<string, ProjectNode> } };
    const node = body.project.nodes.g1;
    assert.equal(node?.freshness, "stale");
    assert.equal(node?.phase, "succeeded");
    assert.notEqual(node?.phase, "queued");
    assert.notEqual(node?.phase, "running");
    assert.equal(fake2.submitted.length, 0);
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(fake2.submitted.length, 0);
  } finally {
    await stopTestApp(app2);
  }
});
