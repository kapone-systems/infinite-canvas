/**
 * 阶段 7 云端车道与视频入库。不睡配方里的 2000ms；poll 停在未兑现的 Promise 上。
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  generationBadge,
  generationHasSettledSuccess,
  RECIPE_IMG2VIDEO_FIXTURE,
  RECIPE_IMG2VIDEO_NEEDS_SECRET,
  USER_FACING,
  videoDerivativesReady,
  type MediaRef,
  type ProjectNode,
  type RunSnapshot,
} from "@canvas/schema";
import { createFixtureVideoAdapter, createNeedsSecretAdapter, FIXTURE_VIDEO_BYTES } from "./adapters/exampleVideoFixture.ts";
import { FakeExecutor, fictionalSuccessPng } from "./fakeExecutor.ts";
import type { ComfyReachability } from "./comfy/client.ts";
import { sniffMagic } from "../media/magic.ts";
import { ingestBytes } from "../media/ingest.ts";
import { absFromRel } from "../media/layout.ts";
import {
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

async function currentNodes(app: TestApp): Promise<Record<string, ProjectNode>> {
  const res = await fetch(`${app.baseUrl}/api/projects/current`, {
    headers: { Authorization: `Bearer ${app.token}` },
  });
  const body = (await res.json()) as { project: { nodes: Record<string, ProjectNode> } };
  return body.project.nodes;
}

async function postRun(app: TestApp, projectId: string, nodeId: string, force = false): Promise<Response> {
  return fetch(`${app.baseUrl}/api/execution/runs`, {
    method: "POST",
    headers: headers(app.origin),
    body: JSON.stringify({
      projectId,
      scope: { type: "node", nodeId },
      force,
      clientRequestId: `c-${nodeId}-${Math.random().toString(16).slice(2)}`,
    }),
  });
}

function videoNode(id: string, recipeId: string, extra: Partial<ProjectNode> = {}): ProjectNode {
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
    ...extra,
  };
}

function downstream(id: string): ProjectNode {
  return txt2imgNode(id, {
    x: 800,
    slots: [{ id: `${id}-prompt`, role: "prompt", order: 0, edgeId: "e-down" }],
    freshness: "fresh",
    phase: "idle",
  });
}

function complete(media: MediaRef): MediaRef {
  const hash = media.contentHash ?? "ab".repeat(32);
  const prefix = hash.slice(0, 2);
  return {
    ...media,
    kind: "video",
    durationMs: 4000,
    firstFrameRelativePath: `media/derived/${prefix}/${hash}/frame-png-native-v1/${"a".repeat(64)}.png`,
    lastFrameRelativePath: `media/derived/${prefix}/${hash}/frame-png-native-v1/${"b".repeat(64)}.png`,
    coverRelativePath: `media/derived/${prefix}/${hash}/poster-webp-longedge-1280-v1/${"c".repeat(64)}.webp`,
    proxyRelativePath: `media/derived/${prefix}/${hash}/proxy-h264-longedge-1280-v1/${"d".repeat(64)}.mp4`,
  };
}

async function putGraph(app: TestApp, nodes: Record<string, ProjectNode>, edges: Record<string, unknown>): Promise<void> {
  const res = await fetch(`${app.baseUrl}/api/projects/current/working-copy`, {
    method: "PUT",
    headers: headers(app.origin),
    body: JSON.stringify({ contentRevision: 0, nodes, edges, groups: {} }),
  });
  assert.equal(res.status, 204);
}

test("夹具 download 是 mp4 且不是媒体库原件；poll 停住时本地车道仍能 submit", async () => {
  assert.equal(sniffMagic(FIXTURE_VIDEO_BYTES).magic, "mp4");
  assert.equal(sniffMagic(FIXTURE_VIDEO_BYTES).kind, "video");
  const png = fictionalSuccessPng();
  assert.notDeepEqual(Buffer.from(FIXTURE_VIDEO_BYTES), Buffer.from(png));
  const fixture = createFixtureVideoAdapter({ hangPoll: true });
  const needs = createNeedsSecretAdapter();
  const fake = new FakeExecutor({ behavior: "hang-until-release" });
  const app = await startTestApp({
    executor: fake,
    comfyReachability: reachable,
    comfyBaseUrl: COMFY,
    cancelTimeoutMs: 400,
    cloudAdapters: [fixture, needs],
    cloudPollIntervalMs: 0,
    deriveVideo: async () => ({ ok: false }),
  });
  try {
    const created = await createProject(app, "video-lane");
    assert.equal(created.status, 201);
    const projectId = created.body.projectId as string;
    const projectDir = created.body.absolutePath as string;
    const ingested = await ingestBytes({ projectRoot: projectDir, bytes: png, originalFileName: "frame.png", makeThumb: true });
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
      { img, v1: videoNode("v1", RECIPE_IMG2VIDEO_FIXTURE), g1: txt2imgNode("g1"), g2: txt2imgNode("g2", { x: 40, y: 40 }) },
      { "e-ff": { id: "e-ff", sourceNodeId: "img", targetNodeId: "v1", targetSlotId: "v1-ff", role: "first_frame" } },
    );
    const cloudRes = await postRun(app, projectId, "v1");
    assert.equal(cloudRes.status, 200);
    const cloudSnap = (await cloudRes.json()) as RunSnapshot;
    assert.equal(cloudSnap.tasks[0]?.lane, "cloud");
    await waitFor(async () => fixture.controls.pollCount >= 1);
    assert.notEqual(cloudSnap.tasks[0]?.state, "succeeded");
    const local1 = await postRun(app, projectId, "g1");
    assert.equal(local1.status, 200);
    await waitFor(() => fake.submitted.length >= 1);
    const still = await fetch(`${app.baseUrl}/api/execution/runs/${cloudSnap.runId}`, {
      headers: { Authorization: `Bearer ${app.token}` },
    });
    const stillBody = (await still.json()) as RunSnapshot;
    assert.notEqual(stillBody.tasks[0]?.state, "succeeded");
    assert.equal(stillBody.state, "running");
    const local2 = await postRun(app, projectId, "g2");
    assert.equal(local2.status, 200);
    await waitFor(async () => {
      const label = (await currentNodes(app)).g2?.progress?.label ?? "";
      return label === USER_FACING.localQueueAhead(1);
    });
    const g2 = (await currentNodes(app)).g2;
    assert.equal(g2?.progress?.label, "前面还有 1 个本地任务");
    assert.equal(g2?.progress?.label?.includes("%"), false);
    assert.equal(fixture.controls.lastFiles.length, 1);
    assert.deepEqual(Buffer.from(fixture.controls.lastFiles[0] ?? new Uint8Array()), Buffer.from(png));
    assert.equal(needs.submitCount, 0);
  } finally {
    fixture.controls.releasePoll();
    fake.releaseAll();
    await new Promise((resolve) => setTimeout(resolve, 50));
    await stopTestApp(app);
  }
});

test("没配 Comfy 时夹具仍能 submit；文生图仍被地址句挡住", async () => {
  const fixture = createFixtureVideoAdapter();
  let deriveMode: "fail" | "ok" = "fail";
  const app = await startTestApp({
    comfyBaseUrl: null,
    cloudAdapters: [fixture, createNeedsSecretAdapter()],
    cloudPollIntervalMs: 0,
    deriveVideo: async ({ media }) => {
      if (deriveMode === "fail") {
        return { ok: false };
      }
      return { ok: true, media: complete(media) };
    },
  });
  try {
    const created = await createProject(app, "no-comfy");
    const projectId = created.body.projectId as string;
    const projectDir = created.body.absolutePath as string;
    const png = fictionalSuccessPng();
    const ingested = await ingestBytes({ projectRoot: projectDir, bytes: png, makeThumb: true });
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
      { img, v1: videoNode("v1", RECIPE_IMG2VIDEO_FIXTURE), g1: txt2imgNode("g1"), down: downstream("down") },
      {
        "e-ff": { id: "e-ff", sourceNodeId: "img", targetNodeId: "v1", targetSlotId: "v1-ff", role: "first_frame" },
        "e-down": { id: "e-down", sourceNodeId: "v1", targetNodeId: "down", targetSlotId: "down-prompt", role: "prompt" },
      },
    );
    const blocked = await postRun(app, projectId, "g1");
    assert.equal(blocked.status, 400);
    assert.equal(((await blocked.json()) as { message: string }).message, USER_FACING.comfyUnconfigured);
    const video = await postRun(app, projectId, "v1");
    assert.equal(video.status, 200);
    assert.equal(((await video.json()) as { message?: string }).message, undefined);
    await waitFor(async () => (await currentNodes(app)).v1?.phase === "idle");
    const partial = (await currentNodes(app)).v1;
    assert.equal(partial?.output?.kind, "video");
    assert.notEqual(partial?.phase, "failed");
    assert.equal(generationBadge(partial!), "empty");
    assert.equal((await currentNodes(app)).down?.freshness, "fresh");
    assert.equal(fixture.controls.submitCount, 1);
    const blob = await readFile(absFromRel(projectDir, partial?.output?.relativePath ?? ""));
    assert.equal(sniffMagic(blob).magic, "mp4");
    assert.notDeepEqual(blob, Buffer.from(png));
    const regen = await fetch(`${app.baseUrl}/api/execution/nodes/v1/regenerate-preview`, {
      method: "POST",
      headers: headers(app.origin),
    });
    assert.equal(regen.status, 400);
    assert.equal(fixture.controls.submitCount, 1);
    deriveMode = "ok";
    const again = await fetch(`${app.baseUrl}/api/execution/nodes/v1/regenerate-preview`, {
      method: "POST",
      headers: headers(app.origin),
    });
    assert.equal(again.status, 200);
    assert.equal(fixture.controls.submitCount, 1);
    const done = (await currentNodes(app)).v1;
    assert.equal(done?.phase, "succeeded");
    assert.equal(videoDerivativesReady(done?.output), true);
    assert.equal((done?.versions ?? []).length, 1);
    assert.equal((await currentNodes(app)).down?.freshness, "stale");
  } finally {
    await stopTestApp(app);
  }
});

test("已有成功版本时派生失败不改 output 和徽章；写齐才再追加版本", async () => {
  const fixture = createFixtureVideoAdapter();
  let mode: "ok" | "fail" = "ok";
  const app = await startTestApp({
    comfyBaseUrl: null,
    cloudAdapters: [fixture],
    cloudPollIntervalMs: 0,
    deriveVideo: async ({ media }) => (mode === "ok" ? { ok: true, media: complete(media) } : { ok: false }),
  });
  try {
    const created = await createProject(app, "second");
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
      { img, v1: videoNode("v1", RECIPE_IMG2VIDEO_FIXTURE) },
      { "e-ff": { id: "e-ff", sourceNodeId: "img", targetNodeId: "v1", targetSlotId: "v1-ff", role: "first_frame" } },
    );
    assert.equal((await postRun(app, projectId, "v1")).status, 200);
    await waitFor(async () => (await currentNodes(app)).v1?.phase === "succeeded");
    const first = (await currentNodes(app)).v1;
    const firstHash = first?.output?.contentHash;
    assert.equal((first?.versions ?? []).length, 1);
    mode = "fail";
    fixture.controls.bytes = Uint8Array.from([0, 0, 0, 0x14, 0x66, 0x74, 0x79, 0x70, 0x6d, 0x70, 0x34, 0x32, 1, 2, 3, 4, 5, 6, 7, 8]);
    assert.equal((await postRun(app, projectId, "v1", true)).status, 200);
    await waitFor(async () => {
      const node = (await currentNodes(app)).v1;
      return node?.phase === "succeeded" && node.lastError?.code === "PROXY_MEDIA_FAILED";
    });
    const second = (await currentNodes(app)).v1;
    assert.equal(second?.phase, "succeeded");
    assert.equal(second?.output?.contentHash, firstHash);
    assert.equal(generationBadge(second!), "succeeded");
    assert.notEqual(generationBadge(second!), "failed");
    assert.equal((second?.versions ?? []).length, 1);
    assert.equal(videoDerivativesReady(second?.output), true);
    const runs = await fetch(`${app.baseUrl}/api/execution/runs/${second?.lastRunId}`, {
      headers: { Authorization: `Bearer ${app.token}` },
    });
    const snap = (await runs.json()) as RunSnapshot;
    const outputs = snap.tasks[0]?.variants.flatMap((item) => item.outputs) ?? [];
    assert.equal(outputs.length > 0, true);
    assert.notEqual(outputs[0]?.contentHash, firstHash);
    assert.equal(fixture.controls.submitCount, 2);
  } finally {
    await stopTestApp(app);
  }
});

test("needs-secret 预检失败且 submit 为 0", async () => {
  const needs = createNeedsSecretAdapter();
  const app = await startTestApp({
    comfyBaseUrl: null,
    cloudAdapters: [createFixtureVideoAdapter(), needs],
    secretPresent: () => false,
  });
  try {
    const created = await createProject(app, "secret");
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
      { img, v1: videoNode("v1", RECIPE_IMG2VIDEO_NEEDS_SECRET) },
      { "e-ff": { id: "e-ff", sourceNodeId: "img", targetNodeId: "v1", targetSlotId: "v1-ff", role: "first_frame" } },
    );
    const before = (await currentNodes(app)).v1?.phase;
    const res = await postRun(app, projectId, "v1");
    assert.equal(res.status, 400);
    assert.equal(((await res.json()) as { message: string }).message, "还没有配置这一家的密钥。");
    assert.equal((await currentNodes(app)).v1?.phase, before);
    assert.equal(needs.submitCount, 0);
  } finally {
    await stopTestApp(app);
  }
});

test("云端取消落到三种终态之一；刷新时运行中的 run 仍是 running", async () => {
  async function one(result: "cancelled" | "unsupported" | "already-finished", expectMessage: string): Promise<void> {
    const fixture = createFixtureVideoAdapter({ hangPoll: true, cancelResult: result });
    const app = await startTestApp({
      comfyBaseUrl: null,
      cancelTimeoutMs: 300,
      cloudAdapters: [fixture],
      cloudPollIntervalMs: 0,
      deriveVideo: async ({ media }) => ({ ok: true, media: complete(media) }),
    });
    try {
      const created = await createProject(app, `cancel-${result}`);
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
        { img, v1: videoNode("v1", RECIPE_IMG2VIDEO_FIXTURE) },
        { "e-ff": { id: "e-ff", sourceNodeId: "img", targetNodeId: "v1", targetSlotId: "v1-ff", role: "first_frame" } },
      );
      const started = await postRun(app, projectId, "v1");
      const snap = (await started.json()) as RunSnapshot;
      await waitFor(async () => fixture.controls.pollCount >= 1);
      const live = await fetch(`${app.baseUrl}/api/execution/runs/${snap.runId}`, {
        headers: { Authorization: `Bearer ${app.token}` },
      });
      assert.equal(((await live.json()) as RunSnapshot).state, "running");
      const taskId = snap.tasks[0]?.taskId ?? "";
      const cancelled = await fetch(`${app.baseUrl}/api/execution/tasks/${taskId}/cancel`, {
        method: "POST",
        headers: headers(app.origin),
      });
      assert.equal(cancelled.status, 200);
      const body = (await cancelled.json()) as { message?: string; state?: string };
      assert.equal(body.message, expectMessage);
      assert.equal(body.message === "已停止在这里等待", false);
    } finally {
      fixture.controls.releasePoll();
      await stopTestApp(app);
    }
  }
  await one("cancelled", USER_FACING.cancelledNoResult);
  await one("unsupported", USER_FACING.cancelUncertain);
  await one("already-finished", USER_FACING.tooLateToCancel);
});

test("未齐的视频 output 在刷新结算时不是成功", () => {
  const pending: ProjectNode = videoNode("v", RECIPE_IMG2VIDEO_FIXTURE, {
    phase: "running",
    output: {
      kind: "video",
      relativePath: "media/blobs/aa/" + "a".repeat(64) + ".blob",
      contentHash: "a".repeat(64),
      byteSize: 8,
      mimeDetected: "video/mp4",
      width: null,
      height: null,
      durationMs: null,
      firstFrameRelativePath: null,
      lastFrameRelativePath: null,
      coverRelativePath: null,
      proxyRelativePath: null,
      thumbRelativePath: null,
    },
  });
  assert.equal(generationHasSettledSuccess(pending), false);
  const image: ProjectNode = txt2imgNode("g", {
    output: {
      kind: "image",
      relativePath: "media/blobs/bb/" + "b".repeat(64) + ".blob",
      contentHash: "b".repeat(64),
      byteSize: 8,
      mimeDetected: "image/png",
      width: 8,
      height: 8,
      durationMs: null,
      firstFrameRelativePath: null,
      lastFrameRelativePath: null,
      coverRelativePath: null,
      proxyRelativePath: null,
      thumbRelativePath: null,
    },
  });
  assert.equal(generationHasSettledSuccess(image), true);
});
