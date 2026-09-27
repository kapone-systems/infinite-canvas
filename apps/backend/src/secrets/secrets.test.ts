/**
 * 阶段 9 凭据库、/api/secrets、设置页状态。不调用真实 CredWrite。
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import {
  RECIPE_IMG2VIDEO_FIXTURE,
  RECIPE_IMG2VIDEO_NEEDS_SECRET,
  RECIPE_TXT2IMG,
  USER_FACING,
  inspectorSecretFollowUp,
  type MediaRef,
  type ProjectNode,
} from "@canvas/schema";
import { createNeedsSecretAdapter } from "../execution/adapters/exampleVideoFixture.ts";
import { fictionalSuccessPng } from "../execution/fakeExecutor.ts";
import { planRun } from "../execution/planRun.ts";
import { loadRecipeById } from "../execution/recipeLoader.ts";
import { headers, startTestApp, stopTestApp, txt2imgNode, type TestApp } from "../http/testApp.ts";
import { ingestBytes } from "../media/ingest.ts";
import { createPlatformSecretStore } from "./platformSecretStore.ts";
import { SecretRefInvalidError, cipherFilePath, credentialTargetName, requireSecretRef } from "./secretRef.ts";
import type { SecretPlatform, SecretStore } from "./types.ts";
import { frameSecretCall, windowsPlatformArgs } from "./windowsPlatform.ts";

const here = dirname(fileURLToPath(import.meta.url));
const MARKER = "phase9-secret-marker";
const FAKE_KEY = "test-key-not-real";
const LONG_SENTENCE = "没有找到这个提供方的密钥。请在这台电脑上重新填写。";

function bytesOf(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function createFakePlatform(): SecretPlatform & {
  creds: Map<string, Uint8Array>;
  calls: { credWrite: number; credRead: number; credDelete: number; protect: number; unprotect: number };
  failCredWrite: boolean;
  failProtect: boolean;
} {
  const creds = new Map<string, Uint8Array>();
  const calls = { credWrite: 0, credRead: 0, credDelete: 0, protect: 0, unprotect: 0 };
  const platform = {
    creds,
    calls,
    failCredWrite: false,
    failProtect: false,
    credWrite(name: string, blob: Uint8Array): void {
      calls.credWrite += 1;
      if (platform.failCredWrite) {
        throw new Error("cred");
      }
      creds.set(name, Uint8Array.from(blob));
    },
    credRead(name: string): Uint8Array | null {
      calls.credRead += 1;
      const hit = creds.get(name);
      return hit === undefined ? null : Uint8Array.from(hit);
    },
    credDelete(name: string): void {
      calls.credDelete += 1;
      creds.delete(name);
    },
    protectData(plain: Uint8Array): Uint8Array {
      calls.protect += 1;
      if (platform.failProtect) {
        throw new Error("dpapi");
      }
      const out = new Uint8Array(plain.length + 1);
      out[0] = 0x5a;
      for (let i = 0; i < plain.length; i += 1) {
        out[i + 1] = (plain[i] ?? 0) ^ 0xff;
      }
      return out;
    },
    unprotectData(cipher: Uint8Array): Uint8Array {
      calls.unprotect += 1;
      if (cipher.length === 0 || cipher[0] !== 0x5a) {
        throw new Error("bad");
      }
      const out = new Uint8Array(cipher.length - 1);
      for (let i = 0; i < out.length; i += 1) {
        out[i] = (cipher[i + 1] ?? 0) ^ 0xff;
      }
      return out;
    },
  };
  return platform;
}

async function filesContain(dir: string, needle: string): Promise<boolean> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return false;
  }
  const buf = Buffer.from(needle, "utf8");
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (await filesContain(full, needle)) {
        return true;
      }
    } else {
      const data = await readFile(full);
      if (data.includes(buf)) {
        return true;
      }
    }
  }
  return false;
}

function counting(inner: SecretStore): SecretStore & { counts: () => { present: number; get: number } } {
  let present = 0;
  let get = 0;
  return {
    counts: () => ({ present, get }),
    async put(ref, secret) {
      return inner.put(ref, secret);
    },
    async get(ref) {
      get += 1;
      return inner.get(ref);
    },
    async present(ref) {
      present += 1;
      return inner.present(ref);
    },
    async delete(ref) {
      return inner.delete(ref);
    },
    presentSync(ref) {
      present += 1;
      return inner.presentSync(ref);
    },
    getSync(ref) {
      get += 1;
      return inner.getSync(ref);
    },
  };
}

async function waitFor(predicate: () => Promise<boolean>, timeoutMs = 4000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await predicate()) {
      return;
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 15));
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

function videoNode(id: string): ProjectNode {
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
    recipeId: RECIPE_IMG2VIDEO_NEEDS_SECRET,
    recipeVersion: 1,
    outputKind: "video",
    params: { durationSeconds: "4" },
    variantCount: 1,
    slots: [{ id: `${id}-ff`, role: "first_frame", order: 0, edgeId: "e-ff" }],
    phase: "idle",
    freshness: "fresh",
    secretRef: { providerId: "example.cloud", account: "default" },
  };
}

test("短密钥与超长密钥只留一份，DELETE 两处都没有", async () => {
  const root = await mkdtemp(join(tmpdir(), "canvas-secret-"));
  const secretsDir = join(root, "secrets");
  const platform = createFakePlatform();
  const restricted: string[] = [];
  const store = createPlatformSecretStore({
    platform,
    secretsDir,
    restrictFile: async (filePath) => {
      restricted.push(filePath);
      const rel = relative(resolve(secretsDir), resolve(filePath));
      if (rel.startsWith("..") || isAbsolute(rel)) {
        throw new Error("escaped");
      }
    },
  });
  const ref = { providerId: "Example.Cloud", account: "default" };
  const target = "CanvasApp:provider:example.cloud:account:default";
  const short = new Uint8Array(2560);
  short.fill(7);
  const longer = new Uint8Array(2561);
  longer.fill(9);
  try {
    await store.put(ref, short);
    assert.equal(credentialTargetName(requireSecretRef("example.cloud", "default")), target);
    assert.equal(platform.creds.has(target), true);
    assert.equal(platform.calls.protect, 0);
    assert.deepEqual(await store.get(ref), short);
    assert.equal(await store.present(ref), true);
    assert.equal(existsSync(secretsDir), false);

    await store.put(ref, longer);
    assert.equal(platform.creds.has(target), false);
    const file = cipherFilePath(secretsDir, requireSecretRef("example.cloud"));
    assert.equal(existsSync(file), true);
    const onDisk = readFileSync(file);
    assert.equal(onDisk.includes(Buffer.from(longer)), false);
    assert.deepEqual(await store.get(ref), longer);
    assert.equal(platform.calls.protect >= 1, true);
    assert.equal(restricted.length >= 1, true);

    await store.put(ref, short);
    assert.equal(existsSync(file), false);
    assert.equal(platform.creds.has(target), true);
    assert.deepEqual(await store.get(ref), short);

    await store.put(ref, longer);
    await store.delete(ref);
    assert.equal(platform.creds.has(target), false);
    assert.equal(existsSync(file), false);
    assert.equal(await store.get(ref), null);
    assert.equal(await store.present(ref), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a.b 留在 secrets 目录内；「..」不建目录且没有目录外文件", async () => {
  const root = await mkdtemp(join(tmpdir(), "canvas-secret-dot-"));
  const secretsDir = join(root, "secrets");
  await writeFile(join(root, "keep.txt"), "keep");
  const platform = createFakePlatform();
  const store = createPlatformSecretStore({
    platform,
    secretsDir,
    restrictFile: async () => undefined,
  });
  try {
    const dotted = new Uint8Array(2561);
    dotted.set(bytesOf("a.b-secret"));
    await store.put({ providerId: "a.b", account: "default" }, dotted);
    const file = cipherFilePath(secretsDir, requireSecretRef("a.b", "default"));
    const rel = relative(resolve(secretsDir), file);
    assert.equal(rel.startsWith(".."), false);
    assert.equal(isAbsolute(rel), false);
    assert.equal(existsSync(file), true);
    assert.equal(readFileSync(file).includes(Buffer.from("a.b-secret")), false);

    await assert.rejects(
      () => store.put({ providerId: "..", account: "default" }, bytesOf(MARKER)),
      SecretRefInvalidError,
    );
    await assert.rejects(
      () => store.put({ providerId: "example.cloud", account: ".." }, bytesOf(MARKER)),
      SecretRefInvalidError,
    );
    const names = await readdir(root);
    assert.deepEqual(names.sort(), ["keep.txt", "secrets"].sort());
    assert.equal(await filesContain(root, MARKER), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("凭据库或 DPAPI 拒绝时没有明文文件", async () => {
  const root = await mkdtemp(join(tmpdir(), "canvas-secret-fail-"));
  const secretsDir = join(root, "secrets");
  const platform = createFakePlatform();
  const store = createPlatformSecretStore({
    platform,
    secretsDir,
    restrictFile: async () => {
      throw new Error("acl");
    },
  });
  try {
    platform.failCredWrite = true;
    await assert.rejects(
      () => store.put({ providerId: "example.cloud" }, bytesOf(MARKER)),
      (err: unknown) => err instanceof Error && err.message === USER_FACING.secretStoreRejected,
    );
    assert.equal(platform.creds.size, 0);
    assert.equal(await filesContain(root, MARKER), false);

    platform.failCredWrite = false;
    platform.failProtect = true;
    const longer = new Uint8Array(2561);
    longer.set(bytesOf(MARKER));
    await assert.rejects(
      () => store.put({ providerId: "example.cloud" }, longer),
      (err: unknown) => err instanceof Error && err.message === USER_FACING.secretStoreRejected,
    );
    assert.equal(existsSync(secretsDir), false);
    assert.equal(await filesContain(root, MARKER), false);

    platform.failProtect = false;
    await assert.rejects(
      () => store.put({ providerId: "example.cloud" }, longer),
      (err: unknown) => err instanceof Error && err.message === USER_FACING.secretStoreRejected,
    );
    assert.equal(await filesContain(root, MARKER), false);
    assert.equal(existsSync(join(secretsDir, "example.cloud__default.bin")), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Windows 参数不把密钥放进 argv，脚本不设本机机器范围保护", () => {
  const secret = bytesOf(MARKER);
  const args = windowsPlatformArgs("C:\\CanvasApp\\wincred.ps1");
  assert.equal(args.join(" ").includes(MARKER), false);
  const frame = frameSecretCall(1, "CanvasApp:provider:example.cloud:account:default", secret);
  assert.equal(frame.includes(Buffer.from(MARKER)), true);
  assert.equal(args.some((arg) => frame.equals(Buffer.from(arg))), false);
  const script = readFileSync(join(here, "wincred.ps1"), "utf8");
  assert.equal(script.includes("CRED_TYPE_GENERIC = 1"), true);
  assert.equal(script.includes("CRYPTPROTECT_LOCAL_MACHINE"), false);
  const acl = readFileSync(join(here, "restrict.ps1"), "utf8");
  assert.equal(acl.includes("SetAccessRuleProtection"), true);
  assert.equal(acl.includes("Everyone"), false);
});

test("PUT 204 与 PUT 4xx 都不回显密钥，GET 只给 present，DELETE 不改 secretRef", async () => {
  const root = await mkdtemp(join(tmpdir(), "canvas-secret-http-"));
  const secretsDir = join(root, "secrets");
  const platform = createFakePlatform();
  const store = createPlatformSecretStore({
    platform,
    secretsDir,
    restrictFile: async () => undefined,
  });
  const logs: string[] = [];
  const app = await startTestApp({
    secretStore: store,
    accessLog: (line) => {
      logs.push(line);
    },
  });
  try {
    const created = await fetch(`${app.baseUrl}/api/projects`, {
      method: "POST",
      headers: headers(app.origin),
      body: JSON.stringify({ parentDir: app.projectsDir, name: "secret-http" }),
    });
    const createdBody = (await created.json()) as { projectId: string; absolutePath: string };
    const projectDir = createdBody.absolutePath;
    const graph = await fetch(`${app.baseUrl}/api/projects/current/working-copy`, {
      method: "PUT",
      headers: headers(app.origin),
      body: JSON.stringify({
        contentRevision: 0,
        nodes: { v1: videoNode("v1") },
        edges: {},
        groups: {},
      }),
    });
    assert.equal(graph.status, 204);

    const put = await fetch(`${app.baseUrl}/api/secrets`, {
      method: "PUT",
      headers: headers(app.origin),
      body: JSON.stringify({ providerId: "example.cloud", account: "default", secret: MARKER }),
    });
    const putText = await put.text();
    assert.equal(put.status, 204);
    assert.equal(putText.length, 0);
    assert.equal(putText.includes(MARKER), false);

    const got = await fetch(`${app.baseUrl}/api/secrets/example.cloud`, {
      headers: { Authorization: `Bearer ${app.token}`, Origin: app.origin },
    });
    const gotText = await got.text();
    assert.equal(got.status, 200);
    assert.deepEqual(JSON.parse(gotText), { present: true });
    assert.equal(gotText.includes(MARKER), false);

    const health = await fetch(`${app.baseUrl}/health`);
    const healthBody = (await health.json()) as { secretStore: string };
    assert.equal(healthBody.secretStore, "not-checked");
    const config = await fetch(`${app.baseUrl}/api/app/config`, {
      headers: { Authorization: `Bearer ${app.token}`, Origin: app.origin },
    });
    const configText = await config.text();
    assert.equal(configText.includes(MARKER), false);
    assert.equal(JSON.parse(configText).secret, undefined);

    const removed = await fetch(`${app.baseUrl}/api/secrets/example.cloud`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${app.token}`, Origin: app.origin },
    });
    const removedText = await removed.text();
    assert.equal(removed.status, 204);
    assert.equal(removedText.includes(MARKER), false);
    assert.equal((await currentNodes(app)).v1?.secretRef?.providerId, "example.cloud");
    const after = await fetch(`${app.baseUrl}/api/secrets/example.cloud`, {
      headers: { Authorization: `Bearer ${app.token}`, Origin: app.origin },
    });
    assert.deepEqual(await after.json(), { present: false });

    platform.failCredWrite = true;
    const denied = await fetch(`${app.baseUrl}/api/secrets`, {
      method: "PUT",
      headers: headers(app.origin),
      body: JSON.stringify({ providerId: "example.cloud", secret: MARKER }),
    });
    const deniedText = await denied.text();
    assert.equal(denied.status, 400);
    assert.equal(JSON.parse(deniedText).message, USER_FACING.secretStoreRejected);
    assert.equal(deniedText.includes(MARKER), false);
    assert.equal(await filesContain(root, MARKER), false);
    assert.equal(await filesContain(projectDir, MARKER), false);
    assert.equal(await filesContain(app.dataDir, MARKER), false);

    const dotdot = await fetch(`${app.baseUrl}/api/secrets`, {
      method: "PUT",
      headers: headers(app.origin),
      body: JSON.stringify({ providerId: "..", secret: MARKER }),
    });
    const dotdotText = await dotdot.text();
    assert.equal(dotdot.status, 400);
    assert.equal(dotdotText.includes(MARKER), false);
    assert.equal(await filesContain(app.dataDir, MARKER), false);
    assert.equal(logs.some((line) => line.includes(MARKER)), false);
    void createdBody.projectId;
  } finally {
    await stopTestApp(app);
    await rm(root, { recursive: true, force: true });
  }
});

test("夹具和本机配方不调 present/get；空库短句不含换电脑长句", async () => {
  let calls = 0;
  const loadRecipe = (id: string) => loadRecipeById(id);
  const img: ProjectNode = {
    id: "img",
    kind: "image",
    title: "图片",
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
    output: {
      kind: "image",
      relativePath: "media/blobs/aa/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.blob",
      contentHash: "a".repeat(64),
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
    } satisfies MediaRef,
  };
  const edge = { id: "e-ff", sourceNodeId: "img", targetNodeId: "v", targetSlotId: "v-ff", role: "first_frame" as const };
  const fixture = planRun({
    request: { projectId: "p", scope: { type: "node", nodeId: "v" }, force: true, clientRequestId: "f" },
    nodes: {
      img,
      v: {
        ...videoNode("v"),
        recipeId: RECIPE_IMG2VIDEO_FIXTURE,
        secretRef: null,
      },
    },
    edges: { "e-ff": edge },
    loadRecipe,
    secretPresent: () => {
      calls += 1;
      return false;
    },
  });
  assert.equal(fixture.ok, true);
  assert.equal(calls, 0);
  calls = 0;
  const local = planRun({
    request: { projectId: "p", scope: { type: "node", nodeId: "g" }, force: true, clientRequestId: "g" },
    nodes: {
      g: txt2imgNode("g"),
    },
    edges: {},
    loadRecipe,
    secretPresent: () => {
      calls += 1;
      return false;
    },
  });
  assert.equal(local.ok, true);
  assert.equal(calls, 0);

  const planSrc = readFileSync(join(here, "../execution/planRun.ts"), "utf8");
  const gate = planSrc.indexOf("if (recipe.requiresSecret)");
  const presentAt = planSrc.indexOf("present({ providerId, account })");
  const after = planSrc.indexOf("return { ok: true };", gate);
  assert.ok(gate >= 0 && presentAt > gate && presentAt < after);
  const runtimeSrc = readFileSync(join(here, "../execution/runtime.ts"), "utf8");
  const runGate = runtimeSrc.indexOf("if (snap.recipe.requiresSecret)");
  const getAt = runtimeSrc.indexOf("secretStore.getSync");
  const runningAt = runtimeSrc.indexOf('phase: "running"', runGate);
  assert.ok(runGate >= 0 && getAt > runGate && getAt < runningAt);
  assert.equal(runtimeSrc.split("secretStore.getSync").length, 2);

  const store = counting((await import("./memorySecretStore.ts")).createMemorySecretStore());
  const needs = createNeedsSecretAdapter();
  const app = await startTestApp({
    comfyBaseUrl: null,
    cloudAdapters: [needs],
    secretStore: store,
  });
  try {
    const created = await fetch(`${app.baseUrl}/api/projects`, {
      method: "POST",
      headers: headers(app.origin),
      body: JSON.stringify({ parentDir: app.projectsDir, name: "empty-secret" }),
    });
    const createdBody = (await created.json()) as { projectId: string; absolutePath: string };
    const ingested = await ingestBytes({
      projectRoot: createdBody.absolutePath,
      bytes: fictionalSuccessPng(),
      makeThumb: true,
    });
    assert.equal(ingested.ok, true);
    if (!ingested.ok) {
      return;
    }
    const imgNode: ProjectNode = { ...img, id: "img", output: ingested.media };
    const put = await fetch(`${app.baseUrl}/api/projects/current/working-copy`, {
      method: "PUT",
      headers: headers(app.origin),
      body: JSON.stringify({
        contentRevision: 0,
        nodes: { img: imgNode, v1: videoNode("v1") },
        edges: { "e-ff": { ...edge, targetNodeId: "v1", targetSlotId: "v1-ff" } },
        groups: {},
      }),
    });
    assert.equal(put.status, 204);
    const before = store.counts();
    const res = await fetch(`${app.baseUrl}/api/execution/runs`, {
      method: "POST",
      headers: headers(app.origin),
      body: JSON.stringify({
        projectId: createdBody.projectId,
        scope: { type: "node", nodeId: "v1" },
        force: true,
        clientRequestId: "empty-1",
      }),
    });
    const raw = await res.text();
    assert.equal(res.status, 400);
    assert.equal(JSON.parse(raw).message, "还没有配置这一家的密钥。");
    assert.equal(raw.includes(LONG_SENTENCE), false);
    assert.equal(JSON.parse(raw).detail, undefined);
    assert.equal(needs.submitCount, 0);
    assert.equal(store.counts().present, before.present + 1);
    assert.equal(store.counts().get, before.get);

    const localRun = await fetch(`${app.baseUrl}/api/execution/runs`, {
      method: "POST",
      headers: headers(app.origin),
      body: JSON.stringify({
        projectId: createdBody.projectId,
        scope: { type: "node", nodeId: "missing-local" },
        force: true,
        clientRequestId: "local-1",
      }),
    });
    assert.equal(localRun.status, 400);
    const localText = await localRun.text();
    void localText;
    const txt = txt2imgNode("txt");
    const putTxt = await fetch(`${app.baseUrl}/api/projects/current/working-copy`, {
      method: "PUT",
      headers: headers(app.origin),
      body: JSON.stringify({
        contentRevision: 1,
        nodes: { txt },
        edges: {},
        groups: {},
      }),
    });
    assert.equal(putTxt.status, 204);
    const beforeLocal = store.counts();
    const comfy = await fetch(`${app.baseUrl}/api/execution/runs`, {
      method: "POST",
      headers: headers(app.origin),
      body: JSON.stringify({
        projectId: createdBody.projectId,
        scope: { type: "node", nodeId: "txt" },
        force: true,
        clientRequestId: "comfy-1",
      }),
    });
    assert.equal(comfy.status, 400);
    assert.equal(((await comfy.json()) as { message: string }).message, USER_FACING.comfyUnconfigured);
    assert.equal(store.counts().present, beforeLocal.present);
    assert.equal(store.counts().get, beforeLocal.get);
    assert.equal(RECIPE_TXT2IMG.length > 0, true);
  } finally {
    await stopTestApp(app);
  }
});

test("假密钥拒绝且工程、错误和设置页文本没有这串钥匙", async () => {
  const store = counting((await import("./memorySecretStore.ts")).createMemorySecretStore());
  const needs = createNeedsSecretAdapter();
  const logs: string[] = [];
  const app = await startTestApp({
    comfyBaseUrl: null,
    cloudAdapters: [needs],
    cloudPollIntervalMs: 0,
    secretStore: store,
    accessLog: (line) => {
      logs.push(line);
    },
  });
  try {
    const created = await fetch(`${app.baseUrl}/api/projects`, {
      method: "POST",
      headers: headers(app.origin),
      body: JSON.stringify({ parentDir: app.projectsDir, name: "fake-key" }),
    });
    const createdBody = (await created.json()) as { projectId: string; absolutePath: string };
    const ingested = await ingestBytes({
      projectRoot: createdBody.absolutePath,
      bytes: fictionalSuccessPng(),
      makeThumb: true,
    });
    assert.equal(ingested.ok, true);
    if (!ingested.ok) {
      return;
    }
    const put = await fetch(`${app.baseUrl}/api/projects/current/working-copy`, {
      method: "PUT",
      headers: headers(app.origin),
      body: JSON.stringify({
        contentRevision: 0,
        nodes: {
          img: {
            id: "img",
            kind: "image",
            title: "图片",
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
          },
          v1: videoNode("v1"),
        },
        edges: {
          "e-ff": { id: "e-ff", sourceNodeId: "img", targetNodeId: "v1", targetSlotId: "v1-ff", role: "first_frame" },
        },
        groups: {},
      }),
    });
    assert.equal(put.status, 204);
    const saved = await fetch(`${app.baseUrl}/api/secrets`, {
      method: "PUT",
      headers: headers(app.origin),
      body: JSON.stringify({ providerId: "example.cloud", secret: FAKE_KEY }),
    });
    assert.equal(saved.status, 204);
    const beforeGet = store.counts().get;
    const res = await fetch(`${app.baseUrl}/api/execution/runs`, {
      method: "POST",
      headers: headers(app.origin),
      body: JSON.stringify({
        projectId: createdBody.projectId,
        scope: { type: "node", nodeId: "v1" },
        force: true,
        clientRequestId: "fake-1",
      }),
    });
    assert.equal(res.status, 200);
    await waitFor(async () => (await currentNodes(app)).v1?.lastError?.message === USER_FACING.secretRejected);
    const current = await fetch(`${app.baseUrl}/api/projects/current`, {
      headers: { Authorization: `Bearer ${app.token}` },
    });
    const currentText = await current.text();
    assert.equal(currentText.includes(FAKE_KEY), false);
    assert.equal((await currentNodes(app)).v1?.secretRef?.providerId, "example.cloud");
    assert.equal(needs.submitCount, 0);
    assert.equal(store.counts().get, beforeGet + 1);
    assert.equal(await filesContain(createdBody.absolutePath, FAKE_KEY), false);
    assert.equal(await filesContain(app.dataDir, FAKE_KEY), false);
    assert.equal(logs.some((line) => line.includes(FAKE_KEY)), false);

    await store.put({ providerId: "example.cloud" }, bytesOf("other-key-value"));
    const runOther = await fetch(`${app.baseUrl}/api/execution/runs`, {
      method: "POST",
      headers: headers(app.origin),
      body: JSON.stringify({
        projectId: createdBody.projectId,
        scope: { type: "node", nodeId: "v1" },
        force: true,
        clientRequestId: "other-1",
      }),
    });
    assert.equal(runOther.status, 200);
    await waitFor(async () => (await currentNodes(app)).v1?.lastError?.message === USER_FACING.generationFailedNoDetail);
    const otherText = JSON.stringify((await currentNodes(app)).v1?.lastError);
    assert.equal(otherText.includes("needs-secret"), false);
    assert.equal(otherText.includes("other-key-value"), false);
    assert.equal(needs.submitCount, 1);
    assert.equal(await filesContain(createdBody.absolutePath, "other-key-value"), false);
    assert.equal(await filesContain(app.dataDir, "other-key-value"), false);
  } finally {
    await stopTestApp(app);
  }
});

test("设置页只有已配置或未配置，检查器在短句下一行自己写长句", () => {
  assert.equal(inspectorSecretFollowUp(USER_FACING.secretMissing), LONG_SENTENCE);
  assert.equal(inspectorSecretFollowUp("还没有配置这一家的密钥。"), LONG_SENTENCE);
  assert.equal(inspectorSecretFollowUp(USER_FACING.comfyUnconfigured), null);
  assert.equal(inspectorSecretFollowUp(null), null);
  assert.equal(inspectorSecretFollowUp(LONG_SENTENCE), null);
  const settings = readFileSync(join(here, "../../../web/src/ui/SettingsForm.tsx"), "utf8");
  const inspector = readFileSync(join(here, "../../../web/src/ui/Inspector.tsx"), "utf8");
  const follow = readFileSync(join(here, "../../../web/src/ui/secretFollowUp.ts"), "utf8");
  const schemaFollow = readFileSync(join(here, "../../../../packages/schema/src/secretFollowUp.ts"), "utf8");
  assert.equal(settings.includes("type=\"password\""), true);
  assert.equal(settings.includes("COPY.secretConfigured"), true);
  assert.equal(settings.includes("COPY.secretNotConfigured"), true);
  assert.equal(settings.includes(LONG_SENTENCE), false);
  assert.equal(settings.includes("alert("), false);
  assert.equal(settings.includes("confirm("), false);
  assert.equal(settings.includes(FAKE_KEY), false);
  assert.equal(inspector.includes("inspectorSecretFollowUp"), true);
  assert.equal(inspector.includes("data-secret-refill"), true);
  assert.equal(inspector.includes(".detail"), false);
  assert.equal(follow.includes("inspectorSecretFollowUp"), true);
  assert.equal(schemaFollow.includes("seenMessage === USER_FACING.secretMissing"), true);
  assert.equal(schemaFollow.includes("return USER_FACING.secretRefillOnThisComputer"), true);
  const health = readFileSync(join(here, "../http/health.ts"), "utf8");
  assert.equal(health.includes('secretStore: "not-checked"'), true);
  const allowed = readFileSync(join(here, "../execution/parseRunRequest.ts"), "utf8");
  assert.equal(allowed.includes('["projectId", "scope", "force", "clientRequestId"]'), true);
  const config = readFileSync(join(here, "../http/appConfig.ts"), "utf8");
  assert.equal(config.includes("secret:"), false);
  const loaded = loadRecipeById(RECIPE_IMG2VIDEO_FIXTURE);
  assert.equal(loaded.ok, true);
  if (loaded.ok) {
    assert.equal(loaded.recipe.requiresSecret, false);
  }
});
