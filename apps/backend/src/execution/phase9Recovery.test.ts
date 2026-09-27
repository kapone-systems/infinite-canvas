/**
 * 阶段 9：心跳、重启对账四条、云端不保证取消、只重跑失败的成功格。
 * 夹具，不打真实 Comfy，不打外网。
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  RECIPE_IMG2VIDEO_FIXTURE,
  RECIPE_IMG2VIDEO_NEEDS_SECRET,
  USER_FACING,
  type MediaRef,
  type ProjectNode,
  type RunSnapshot,
} from "@canvas/schema";
import { createFixtureVideoAdapter, type CloudPollResult, type CloudVideoAdapter } from "./adapters/exampleVideoFixture.ts";
import type { ComfyExecutor, ComfyPromptInspect, ComfyReachability, ComfySubmitInput, ComfyWaitResult } from "./comfy/client.ts";
import { FakeExecutor, fictionalSuccessPng } from "./fakeExecutor.ts";
import { ingestBytes } from "../media/ingest.ts";
import {
  closeTestApp,
  createProject,
  headers,
  startTestApp,
  stopTestApp,
  txt2imgNode,
  type TestApp,
} from "../http/testApp.ts";

const reachable: ComfyReachability = {
  probe: async () => ({ reachable: true, message: "" }),
};

const COMFY = "http://127.0.0.1:8188";
const runtimeSrc = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "runtime.ts"), "utf8");

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

async function currentProject(app: TestApp): Promise<{
  contentRevision: number;
  nodes: Record<string, ProjectNode>;
  edges: Record<string, unknown>;
}> {
  const res = await fetch(`${app.baseUrl}/api/projects/current`, {
    headers: { Authorization: `Bearer ${app.token}` },
  });
  const body = (await res.json()) as {
    project: { contentRevision: number; nodes: Record<string, ProjectNode>; edges: Record<string, unknown> };
  };
  return body.project;
}

async function postRun(app: TestApp, projectId: string, nodeId: string): Promise<Response> {
  return fetch(`${app.baseUrl}/api/execution/runs`, {
    method: "POST",
    headers: headers(app.origin),
    body: JSON.stringify({
      projectId,
      scope: { type: "node", nodeId },
      force: false,
      clientRequestId: `c-${nodeId}-${Math.random().toString(16).slice(2)}`,
    }),
  });
}

async function getRun(app: TestApp, runId: string): Promise<RunSnapshot> {
  const res = await fetch(`${app.baseUrl}/api/execution/runs/${runId}`, {
    headers: { Authorization: `Bearer ${app.token}` },
  });
  assert.equal(res.status, 200);
  return (await res.json()) as RunSnapshot;
}

function videoNode(id: string, recipeId: string): ProjectNode {
  return {
    id,
    kind: "generation",
    title: "图生视频 1",
    x: 400,
    y: 0,
    width: 320,
    height: 240,
    z: 2,
    groupId: null,
    origin: "authored",
    createdAt: "2026-09-26T00:00:00.000Z",
    updatedAt: "2026-09-26T00:00:00.000Z",
    outputRevision: 1,
    promptDraft: "",
    capabilityId: "video.generate",
    profileId: "img2video",
    recipeId,
    recipeVersion: 1,
    outputKind: "video",
    params: { durationSeconds: "4" },
    variantCount: 1,
    slots: [{ id: `${id}-ff`, role: "first_frame", order: 0, edgeId: "e-ff" }],
    phase: "idle",
    freshness: "fresh",
    secretRef: recipeId === RECIPE_IMG2VIDEO_NEEDS_SECRET ? { providerId: "example.cloud", account: "default" } : null,
  };
}

type RecordingExecutor = ComfyExecutor & {
  submitted: ComfySubmitInput[];
  waitIds: string[];
};

function recordingExecutor(inspectFor: (promptId: string) => ComfyPromptInspect): RecordingExecutor {
  const submitted: ComfySubmitInput[] = [];
  const waitIds: string[] = [];
  const exec: RecordingExecutor = {
    submitted,
    waitIds,
    async submit(input) {
      submitted.push(input);
      return { promptId: `new-${submitted.length}` };
    },
    wait(promptId, signal) {
      waitIds.push(promptId);
      return new Promise<ComfyWaitResult>((resolve) => {
        const finish = (): void => {
          resolve({ ok: false, code: "cancelled", message: USER_FACING.cancelledNoResult });
        };
        if (signal.aborted) {
          finish();
          return;
        }
        signal.addEventListener("abort", finish, { once: true });
      });
    },
    async interrupt() {
      return undefined;
    },
    async uploadImage() {
      return { name: "up.png" };
    },
    inspectPrompt(promptId) {
      return inspectFor(promptId);
    },
  };
  return exec;
}

async function hangUntilSubmitted(): Promise<{
  reuse: { root: string; dataDir: string; projectsDir: string; homeDir: string };
  runId: string;
  taskId: string;
  promptId: string;
  absolutePath: string;
  projectId: string;
}> {
  const fake = new FakeExecutor({ behavior: "hang-until-release" });
  const app = await startTestApp({
    executor: fake,
    comfyReachability: reachable,
    comfyBaseUrl: COMFY,
  });
  try {
    const created = await createProject(app, "reconcile");
    const projectId = created.body.projectId as string;
    const absolutePath = String(created.body.absolutePath);
    await putGraph(app, 0, {
      g1: txt2imgNode("g1"),
      g2: txt2imgNode("g2", { x: 700, promptDraft: "另一张" }),
    });
    const started = await postRun(app, projectId, "g1");
    assert.equal(started.status, 200);
    const snap = (await started.json()) as RunSnapshot;
    const queued = await postRun(app, projectId, "g2");
    assert.equal(queued.status, 200);
    let promptId = "";
    await waitFor(async () => {
      const body = await getRun(app, snap.runId);
      promptId = body.tasks[0]?.variants.find((item) => item.providerJobId != null)?.providerJobId ?? "";
      return promptId.length > 0;
    });
    return {
      reuse: { root: app.root, dataDir: app.dataDir, projectsDir: app.projectsDir, homeDir: app.homeDir },
      runId: snap.runId,
      taskId: snap.tasks[0]?.taskId ?? "",
      promptId,
      absolutePath,
      projectId,
    };
  } finally {
    await closeTestApp(app);
  }
}

async function openAbsolute(app: TestApp, absolutePath: string): Promise<Record<string, ProjectNode>> {
  const opened = await fetch(`${app.baseUrl}/api/projects/open`, {
    method: "POST",
    headers: headers(app.origin),
    body: JSON.stringify({ absolutePath }),
  });
  assert.equal(opened.status, 200);
  const body = (await opened.json()) as { project: { nodes: Record<string, ProjectNode> } };
  return body.project.nodes;
}

test("finishUncertain 函数体仍是取消结果不确定，本地超时仍调用它", () => {
  const start = runtimeSrc.indexOf("async function finishUncertain");
  const end = runtimeSrc.indexOf("async function finishStoppedWaiting");
  const body = runtimeSrc.slice(start, end);
  assert.equal(body.includes("cancelUncertain"), true);
  assert.equal(body.includes("stoppedWaiting"), false);
  assert.equal(body.includes("已停止在这里等待"), false);
  const localStart = runtimeSrc.indexOf("async function submitAndWait");
  const localEnd = runtimeSrc.indexOf("function markRemainingFailed");
  const local = runtimeSrc.slice(localStart, localEnd);
  assert.equal(local.includes("await finishUncertain(task, snap)"), true);
  assert.equal(local.includes("finishCloudUnclear"), false);
  assert.equal(local.includes("finishStoppedWaiting"), false);
  assert.equal(runtimeSrc.includes("正在核对上次没跑完的任务"), false);
  assert.equal(runtimeSrc.includes("重启后没能对上上次的任务"), false);
});

test("对上仍在队列：不回 queued、不 submit，之后的 startRun 也不提交它", async () => {
  const first = await hangUntilSubmitted();
  const exec = recordingExecutor((id) => (id === first.promptId ? { kind: "queued" } : { kind: "missing" }));
  const app = await startTestApp({
    reuse: first.reuse,
    executor: exec,
    comfyReachability: reachable,
    comfyBaseUrl: COMFY,
  });
  try {
    const beforeOpen = await getRun(app, first.runId);
    assert.notEqual(beforeOpen.tasks[0]?.state, "queued");
    assert.equal(beforeOpen.tasks[0]?.state, "running");
    const nodes = await openAbsolute(app, first.absolutePath);
    assert.equal(nodes.g1?.phase, "running");
    assert.notEqual(nodes.g2?.phase, "queued");
    assert.notEqual(nodes.g2?.phase, "running");
    assert.equal(nodes.g2?.lastError?.message, USER_FACING.restartUncertain);
    assert.equal(exec.submitted.length, 0);
    assert.equal(exec.waitIds.includes(first.promptId), true);
    const again = await postRun(app, first.projectId, "g2");
    assert.notEqual(again.status, 500);
    await new Promise((resolve) => setTimeout(resolve, 40));
    assert.equal(exec.submitted.some((item) => item.taskId === first.taskId), false);
    const after = await getRun(app, first.runId);
    assert.notEqual(after.tasks[0]?.state, "queued");
    assert.equal(exec.submitted.length, 0);
  } finally {
    await stopTestApp(app);
  }
});

test("历史已成功只入库，不 submit", async () => {
  const first = await hangUntilSubmitted();
  const png = fictionalSuccessPng();
  const exec = recordingExecutor((id) => (
    id === first.promptId ? { kind: "succeeded", images: [{ bytes: png, mime: "image/png" }] } : { kind: "missing" }
  ));
  const app = await startTestApp({
    reuse: first.reuse,
    executor: exec,
    comfyReachability: reachable,
    comfyBaseUrl: COMFY,
  });
  try {
    await openAbsolute(app, first.absolutePath);
    await waitFor(async () => {
      const run = await getRun(app, first.runId);
      return run.tasks[0]?.state === "succeeded";
    });
    const node = (await currentProject(app)).nodes.g1;
    assert.equal(node?.phase, "succeeded");
    assert.notEqual(node?.phase, "running");
    assert.notEqual(node?.phase, "queued");
    assert.equal(node?.output?.contentHash != null && node.output.contentHash.length === 64, true);
    assert.equal(exec.submitted.length, 0);
    assert.equal(exec.waitIds.length, 0);
    const run = await getRun(app, first.runId);
    assert.equal(run.tasks[0]?.state, "succeeded");
  } finally {
    await stopTestApp(app);
  }
});

test("上游找不到或不可达都停转圈且不 submit", async () => {
  async function one(kind: "missing" | "unreachable"): Promise<void> {
    const first = await hangUntilSubmitted();
    const exec = recordingExecutor(() => ({ kind }));
    const app = await startTestApp({
      reuse: first.reuse,
      executor: exec,
      comfyReachability: reachable,
      comfyBaseUrl: COMFY,
    });
    try {
      const nodes = await openAbsolute(app, first.absolutePath);
      assert.notEqual(nodes.g1?.phase, "queued");
      assert.notEqual(nodes.g1?.phase, "running");
      assert.equal(nodes.g1?.progress ?? null, null);
      assert.equal(nodes.g1?.lastError?.message, USER_FACING.restartUncertain);
      assert.equal(nodes.g1?.lastError?.detail, USER_FACING.resumeHint);
      const text = JSON.stringify(nodes.g1?.lastError);
      assert.equal(text.includes("正在核对上次没跑完的任务"), false);
      assert.equal(text.includes("重启后没能对上上次的任务"), false);
      assert.equal(exec.submitted.length, 0);
      assert.equal(exec.waitIds.length, 0);
      const run = await getRun(app, first.runId);
      assert.notEqual(run.state, "running");
      assert.equal(run.tasks[0]?.state, "interrupted");
      assert.equal(run.summary, USER_FACING.restartUncertain);
    } finally {
      await stopTestApp(app);
    }
  }
  await one("missing");
  await one("unreachable");
});

test("过期节点重启后不新建任务", async () => {
  const fake = new FakeExecutor({ behavior: "succeed-immediately" });
  const app = await startTestApp({
    executor: fake,
    comfyReachability: reachable,
    comfyBaseUrl: COMFY,
  });
  let reuse: { root: string; dataDir: string; projectsDir: string; homeDir: string } | undefined;
  let absolutePath = "";
  try {
    const created = await createProject(app, "stale-hold");
    absolutePath = String(created.body.absolutePath);
    await putGraph(app, 0, { g1: txt2imgNode("g1", { promptDraft: "原来的" }) });
    const projectId = created.body.projectId as string;
    const started = await postRun(app, projectId, "g1");
    assert.equal(started.status, 200);
    await waitFor(async () => (await currentProject(app)).nodes.g1?.phase === "succeeded");
    const project = await currentProject(app);
    const node = project.nodes.g1;
    assert.ok(node);
    node.promptDraft = "改过的字";
    node.freshness = "stale";
    await putGraph(app, project.contentRevision, project.nodes, project.edges);
    reuse = { root: app.root, dataDir: app.dataDir, projectsDir: app.projectsDir, homeDir: app.homeDir };
  } finally {
    await closeTestApp(app);
  }
  const exec = recordingExecutor(() => ({ kind: "queued" }));
  const app2 = await startTestApp({
    reuse,
    executor: exec,
    comfyReachability: reachable,
    comfyBaseUrl: COMFY,
  });
  try {
    const nodes = await openAbsolute(app2, absolutePath);
    await new Promise((resolve) => setTimeout(resolve, 40));
    const later = (await currentProject(app2)).nodes.g1;
    assert.equal(later?.freshness, "stale");
    assert.equal(later?.phase, "succeeded");
    assert.notEqual(later?.phase, "queued");
    assert.notEqual(later?.phase, "running");
    assert.equal(exec.submitted.length, 0);
    assert.equal(nodes.g1?.phase, "succeeded");
  } finally {
    await stopTestApp(app2);
  }
});

test("指纹变了续跑不提交、不新造句子；指纹没变只提交没完成的", async () => {
  const first = await hangUntilSubmitted();
  const changed = new FakeExecutor({ behavior: "succeed-immediately" });
  const app = await startTestApp({
    reuse: first.reuse,
    executor: changed,
    comfyReachability: reachable,
    comfyBaseUrl: COMFY,
  });
  try {
    await openAbsolute(app, first.absolutePath);
    const project = await currentProject(app);
    const node = project.nodes.g1;
    assert.ok(node);
    node.promptDraft = "指纹变了";
    await putGraph(app, project.contentRevision, project.nodes, project.edges);
    const resumed = await fetch(`${app.baseUrl}/api/execution/runs/${first.runId}/resume`, {
      method: "POST",
      headers: headers(app.origin),
    });
    assert.equal(resumed.status, 200);
    const text = await resumed.text();
    assert.equal(text.includes("正在核对上次没跑完的任务"), false);
    assert.equal(text.includes("重启后没能对上上次的任务"), false);
    await new Promise((resolve) => setTimeout(resolve, 40));
    assert.equal(changed.submitted.length, 0);
    const still = await getRun(app, first.runId);
    assert.equal(still.tasks[0]?.state, "interrupted");
    assert.notEqual(still.tasks[0]?.state, "queued");
  } finally {
    await stopTestApp(app);
  }

  const again = await hangUntilSubmitted();
  const same = new FakeExecutor({ behavior: "succeed-immediately" });
  const app2 = await startTestApp({
    reuse: again.reuse,
    executor: same,
    comfyReachability: reachable,
    comfyBaseUrl: COMFY,
  });
  try {
    await openAbsolute(app2, again.absolutePath);
    const resumed = await fetch(`${app2.baseUrl}/api/execution/runs/${again.runId}/resume`, {
      method: "POST",
      headers: headers(app2.origin),
    });
    assert.equal(resumed.status, 200);
    await waitFor(() => same.submitted.length >= 1);
    assert.equal(same.submitted.every((item) => item.taskId !== again.taskId), true);
    assert.equal(same.submitted[0]?.variantIndex, 0);
    const old = await getRun(app2, again.runId);
    assert.equal(old.tasks[0]?.state, "interrupted");
    assert.notEqual(old.tasks[0]?.state, "queued");
  } finally {
    await stopTestApp(app2);
  }
});

test("executor.submit 进入时成功格的 phase、seedUsed、output 还在", async () => {
  let app: TestApp | undefined;
  let capture = false;
  const shot = {
    phase: "",
    seedUsed: null as number | null,
    output: null as ProjectNode["output"],
    ready: false,
  };
  const fake = new FakeExecutor({
    behavior: () => {
      if (capture && app !== undefined) {
        const node = app.backend.session.current?.project.nodes.g1;
        const version = node?.versions?.find((item) => item.id === node.currentVersionId);
        const cell = version?.variants[0];
        if (cell !== undefined) {
          shot.phase = cell.phase;
          shot.seedUsed = cell.seedUsed;
          shot.output = cell.output ?? null;
          shot.ready = true;
        }
      }
      return "succeed-immediately";
    },
    failAtVariantIndex: 1,
  });
  app = await startTestApp({
    executor: fake,
    comfyReachability: reachable,
    comfyBaseUrl: COMFY,
  });
  try {
    const created = await createProject(app, "retry-cell");
    const projectId = created.body.projectId as string;
    await putGraph(app, 0, {
      g1: txt2imgNode("g1", { variantCount: 4, params: { seed: 7, width: 1024, height: 1024 } }),
    });
    const started = await postRun(app, projectId, "g1");
    assert.equal(started.status, 200);
    const snap = (await started.json()) as RunSnapshot;
    await waitFor(async () => (await currentProject(app!)).nodes.g1?.phase === "succeeded");
    const before = (await currentProject(app)).nodes.g1;
    const beforeVersion = before?.versions?.find((item) => item.id === before.currentVersionId);
    const beforeCell = beforeVersion?.variants[0];
    assert.equal(beforeCell?.phase, "succeeded");
    assert.equal(beforeCell?.seedUsed, 7);
    assert.notEqual(beforeCell?.output, null);
    const submittedBefore = fake.submitted.length;
    capture = true;
    const retry = await fetch(`${app.baseUrl}/api/execution/runs/${snap.runId}/retry-failed`, {
      method: "POST",
      headers: headers(app.origin),
    });
    assert.equal(retry.status, 200);
    await waitFor(() => shot.ready);
    assert.equal(shot.phase, "succeeded");
    assert.equal(shot.seedUsed, beforeCell?.seedUsed);
    assert.equal(shot.output?.contentHash, beforeCell?.output?.contentHash);
    const retried = fake.submitted.slice(submittedBefore);
    assert.equal(retried.some((item) => item.variantIndex === 0), false);
    assert.equal(retried[0]?.variantIndex, 1);
  } finally {
    if (app !== undefined) {
      await stopTestApp(app);
    }
  }
});

test("hangPoll 期间推进 now()，主句变心跳句且 ratio 不自己加", async () => {
  let clock = Date.parse("2026-09-26T00:00:00.000Z");
  let pollCount = 0;
  let release: (result: CloudPollResult) => void = () => {};
  const base = createFixtureVideoAdapter();
  const adapter: CloudVideoAdapter = {
    id: "example.video.fixture",
    kind: "video.generate",
    profileId: "img2video",
    constraints: base.constraints,
    async submit(input) {
      return { providerJobId: `hb-${input.taskId}` };
    },
    poll() {
      pollCount += 1;
      if (pollCount === 1) {
        return Promise.resolve({ state: "running" });
      }
      return new Promise((resolve) => {
        release = resolve;
      });
    },
    async cancel() {
      return "cancelled";
    },
    async download() {
      return { bytes: base.controls.bytes, mime: "video/mp4" };
    },
  };
  const app = await startTestApp({
    now: () => new Date(clock),
    cloudHeartbeatStaleMs: 1000,
    cloudHeartbeatTickMs: 20,
    cloudPollIntervalMs: 0,
    cloudAdapters: [adapter],
    comfyBaseUrl: null,
    deriveVideo: async ({ media }) => ({ ok: true, media }),
  });
  try {
    const created = await createProject(app, "heartbeat");
    const projectId = created.body.projectId as string;
    const projectDir = created.body.absolutePath as string;
    const ingested = await ingestBytes({ projectRoot: projectDir, bytes: fictionalSuccessPng(), makeThumb: true });
    assert.equal(ingested.ok, true);
    if (!ingested.ok) {
      return;
    }
    const img: ProjectNode = {
      id: "img",
      kind: "image",
      title: "图片 1",
      x: 0,
      y: 0,
      width: 80,
      height: 80,
      z: 0,
      groupId: null,
      origin: "imported",
      createdAt: "2026-09-26T00:00:00.000Z",
      updatedAt: "2026-09-26T00:00:00.000Z",
      outputRevision: 1,
      output: ingested.media,
    };
    await putGraph(
      app,
      0,
      { img, v1: videoNode("v1", RECIPE_IMG2VIDEO_FIXTURE) },
      { "e-ff": { id: "e-ff", sourceNodeId: "img", targetNodeId: "v1", targetSlotId: "v1-ff", role: "first_frame" } },
    );
    const started = await postRun(app, projectId, "v1");
    assert.equal(started.status, 200);
    await waitFor(() => pollCount >= 2);
    const live = app.backend.session.current?.project.nodes.v1;
    assert.ok(live);
    live.progress = { ratio: 0.4, label: live.progress?.label ?? USER_FACING.generatingLabel };
    clock += 5000;
    await waitFor(() => {
      const label = app.backend.session.current?.project.nodes.v1?.progress?.label ?? "";
      return label.startsWith("云端还在处理，上次有回应是 ");
    });
    const beating = app.backend.session.current?.project.nodes.v1;
    const label = beating?.progress?.label ?? "";
    assert.match(label, /^云端还在处理，上次有回应是 (\d+) 秒前$/);
    const seconds = Number(/^云端还在处理，上次有回应是 (\d+) 秒前$/.exec(label)?.[1]);
    assert.equal(Number.isInteger(seconds), true);
    assert.ok(seconds >= 0);
    assert.equal(label.includes("%"), false);
    assert.equal(beating?.progress?.ratio, 0.4);
    release({ state: "running" });
    await waitFor(() => app.backend.session.current?.project.nodes.v1?.progress?.label === USER_FACING.generatingLabel);
    assert.equal(app.backend.session.current?.project.nodes.v1?.progress?.ratio, 0.4);
  } finally {
    release({ state: "running" });
    await stopTestApp(app);
  }
});

test("requiresSecret 取消超时或 unsupported 是已停止在这里等待，之后不入库", async () => {
  async function one(mode: "unsupported" | "timeout"): Promise<void> {
    let downloads = 0;
    const base = createFixtureVideoAdapter();
    const adapter: CloudVideoAdapter = {
      id: "example.video.needs-secret",
      kind: "video.generate",
      profileId: "img2video",
      constraints: base.constraints,
      async submit(input) {
        return { providerJobId: `sec-${input.taskId}` };
      },
      poll() {
        return new Promise(() => undefined);
      },
      cancel() {
        if (mode === "timeout") {
          return new Promise(() => undefined);
        }
        return Promise.resolve("unsupported");
      },
      async download() {
        downloads += 1;
        return { bytes: base.controls.bytes, mime: "video/mp4" };
      },
    };
    const app = await startTestApp({
      comfyBaseUrl: null,
      cancelTimeoutMs: 40,
      cloudAdapters: [adapter],
      cloudPollIntervalMs: 0,
      secretPresent: () => true,
      deriveVideo: async ({ media }) => ({ ok: true, media: media satisfies MediaRef }),
    });
    try {
      const created = await createProject(app, `stop-${mode}`);
      const projectId = created.body.projectId as string;
      const projectDir = created.body.absolutePath as string;
      const ingested = await ingestBytes({ projectRoot: projectDir, bytes: fictionalSuccessPng(), makeThumb: true });
      assert.equal(ingested.ok, true);
      if (!ingested.ok) {
        return;
      }
      const img: ProjectNode = {
        id: "img",
        kind: "image",
        title: "图片 1",
        x: 0,
        y: 0,
        width: 80,
        height: 80,
        z: 0,
        groupId: null,
        origin: "imported",
        createdAt: "2026-09-26T00:00:00.000Z",
        updatedAt: "2026-09-26T00:00:00.000Z",
        outputRevision: 1,
        output: ingested.media,
      };
      await putGraph(
        app,
        0,
        { img, v1: videoNode("v1", RECIPE_IMG2VIDEO_NEEDS_SECRET) },
        { "e-ff": { id: "e-ff", sourceNodeId: "img", targetNodeId: "v1", targetSlotId: "v1-ff", role: "first_frame" } },
      );
      const started = await postRun(app, projectId, "v1");
      assert.equal(started.status, 200);
      const snap = (await started.json()) as RunSnapshot;
      const taskId = snap.tasks[0]?.taskId ?? "";
      await waitFor(async () => (await getRun(app, snap.runId)).state === "running");
      const cancelled = await fetch(`${app.baseUrl}/api/execution/tasks/${taskId}/cancel`, {
        method: "POST",
        headers: headers(app.origin),
      });
      assert.equal(cancelled.status, 200);
      const body = (await cancelled.json()) as { message?: string };
      assert.equal(body.message, USER_FACING.stoppedWaiting);
      const node = (await currentProject(app)).nodes.v1;
      assert.equal(node?.lastError?.message, USER_FACING.stoppedWaiting);
      assert.equal(node?.lastError?.detail, USER_FACING.cloudCancelMayFinish);
      assert.notEqual(node?.phase, "queued");
      assert.notEqual(node?.phase, "running");
      assert.equal(node?.progress ?? null, null);
      assert.equal(downloads, 0);
      assert.equal(node?.versions?.length ?? 0, 0);
    } finally {
      await stopTestApp(app);
    }
  }
  await one("unsupported");
  await one("timeout");
});

test("requiresSecret 明确取消仍是已取消，来不及取消仍是来不及", async () => {
  async function one(result: "cancelled" | "already-finished", expectMessage: string): Promise<void> {
    const base = createFixtureVideoAdapter();
    const adapter: CloudVideoAdapter = {
      id: "example.video.needs-secret",
      kind: "video.generate",
      profileId: "img2video",
      constraints: base.constraints,
      async submit(input) {
        return { providerJobId: `sec-${input.taskId}` };
      },
      poll() {
        return new Promise(() => undefined);
      },
      async cancel() {
        return result;
      },
      async download() {
        return { bytes: base.controls.bytes, mime: "video/mp4" };
      },
    };
    const app = await startTestApp({
      comfyBaseUrl: null,
      cancelTimeoutMs: 300,
      cloudAdapters: [adapter],
      cloudPollIntervalMs: 0,
      secretPresent: () => true,
      deriveVideo: async ({ media }) => ({ ok: true, media }),
    });
    try {
      const created = await createProject(app, `keep-${result}`);
      const projectId = created.body.projectId as string;
      const projectDir = created.body.absolutePath as string;
      const ingested = await ingestBytes({ projectRoot: projectDir, bytes: fictionalSuccessPng(), makeThumb: true });
      assert.equal(ingested.ok, true);
      if (!ingested.ok) {
        return;
      }
      const img: ProjectNode = {
        id: "img",
        kind: "image",
        title: "图片 1",
        x: 0,
        y: 0,
        width: 80,
        height: 80,
        z: 0,
        groupId: null,
        origin: "imported",
        createdAt: "2026-09-26T00:00:00.000Z",
        updatedAt: "2026-09-26T00:00:00.000Z",
        outputRevision: 1,
        output: ingested.media,
      };
      await putGraph(
        app,
        0,
        { img, v1: videoNode("v1", RECIPE_IMG2VIDEO_NEEDS_SECRET) },
        { "e-ff": { id: "e-ff", sourceNodeId: "img", targetNodeId: "v1", targetSlotId: "v1-ff", role: "first_frame" } },
      );
      const started = await postRun(app, projectId, "v1");
      assert.equal(started.status, 200);
      const snap = (await started.json()) as RunSnapshot;
      await waitFor(async () => (await getRun(app, snap.runId)).state === "running");
      const taskId = snap.tasks[0]?.taskId ?? "";
      const cancelled = await fetch(`${app.baseUrl}/api/execution/tasks/${taskId}/cancel`, {
        method: "POST",
        headers: headers(app.origin),
      });
      assert.equal(cancelled.status, 200);
      const body = (await cancelled.json()) as { message?: string };
      assert.equal(body.message, expectMessage);
      assert.equal(body.message === USER_FACING.stoppedWaiting, false);
    } finally {
      await stopTestApp(app);
    }
  }
  await one("cancelled", USER_FACING.cancelledNoResult);
  await one("already-finished", USER_FACING.tooLateToCancel);
});
