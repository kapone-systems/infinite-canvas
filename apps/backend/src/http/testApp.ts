import type { MediaRef, ProjectNode } from "@canvas/schema";
import { RECIPE_IMG2IMG, RECIPE_REFERENCE, RECIPE_TXT2IMG } from "@canvas/schema";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ComfyExecutor, ComfyReachability } from "../execution/comfy/client.ts";
import type { CloudVideoAdapter } from "../execution/adapters/exampleVideoFixture.ts";
import type { SecretStore } from "../secrets/types.ts";
import type { ComfyTunnel } from "../ssh/comfyTunnel.ts";
import { startBackend, STUB_FFMPEG, type Backend } from "./createServer.ts";

export const TEST_TOKEN = "phase1-test-token";

export function txt2imgNode(id: string, extra: Partial<ProjectNode> = {}): ProjectNode {
  return {
    id,
    kind: "generation",
    title: "文生图 1",
    x: 320,
    y: 0,
    width: 320,
    height: 232,
    z: 1,
    groupId: null,
    origin: "authored",
    createdAt: "2026-09-24T00:00:00.000Z",
    updatedAt: "2026-09-24T00:00:00.000Z",
    outputRevision: 1,
    promptDraft: extra.promptDraft ?? "一只纸船",
    capabilityId: "image.generate",
    profileId: "txt2img",
    recipeId: RECIPE_TXT2IMG,
    recipeVersion: 1,
    outputKind: "image",
    params: { seed: "random", width: 1024, height: 1024 },
    variantCount: 1,
    slots: [{ id: `${id}-prompt`, role: "prompt", order: 0, edgeId: null }],
    phase: "idle",
    freshness: "fresh",
    ...extra,
  };
}

export function textNode(id: string, text: string, extra: Partial<ProjectNode> = {}): ProjectNode {
  return {
    id,
    kind: "text",
    title: "文本 1",
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
    text,
    ...extra,
  };
}

export function img2imgNode(id: string, extra: Partial<ProjectNode> = {}): ProjectNode {
  return {
    id,
    kind: "generation",
    title: "图生图 1",
    x: 320,
    y: 0,
    width: 320,
    height: 268,
    z: 1,
    groupId: null,
    origin: "authored",
    createdAt: "2026-09-24T00:00:00.000Z",
    updatedAt: "2026-09-24T00:00:00.000Z",
    outputRevision: 1,
    promptDraft: extra.promptDraft ?? "改这张",
    capabilityId: "image.generate",
    profileId: "img2img",
    recipeId: RECIPE_IMG2IMG,
    recipeVersion: 1,
    outputKind: "image",
    params: { seed: "random", width: 1024, height: 1024 },
    variantCount: 1,
    slots: [
      { id: `${id}-prompt`, role: "prompt", order: 0, edgeId: extra.slots?.[0]?.edgeId ?? null },
      { id: `${id}-src`, role: "source_image", order: 1, edgeId: extra.slots?.[1]?.edgeId ?? null },
    ],
    phase: "idle",
    freshness: "fresh",
    ...extra,
  };
}

export function referenceNode(id: string, extra: Partial<ProjectNode> = {}): ProjectNode {
  return {
    id,
    kind: "generation",
    title: "参考图 1",
    x: 320,
    y: 0,
    width: 320,
    height: 268,
    z: 1,
    groupId: null,
    origin: "authored",
    createdAt: "2026-09-24T00:00:00.000Z",
    updatedAt: "2026-09-24T00:00:00.000Z",
    outputRevision: 1,
    promptDraft: extra.promptDraft ?? "参考生成",
    capabilityId: "image.generate",
    profileId: "reference",
    recipeId: RECIPE_REFERENCE,
    recipeVersion: 1,
    outputKind: "image",
    params: { seed: "random", width: 1024, height: 1024 },
    variantCount: 1,
    slots: [
      { id: `${id}-prompt`, role: "prompt", order: 0, edgeId: extra.slots?.[0]?.edgeId ?? null },
      { id: `${id}-ref`, role: "reference_image", order: 1, edgeId: extra.slots?.[1]?.edgeId ?? null },
    ],
    phase: "idle",
    freshness: "fresh",
    ...extra,
  };
}

export function imageNode(id: string, output: MediaRef, extra: Partial<ProjectNode> = {}): ProjectNode {
  return {
    id,
    kind: "image",
    title: "图片 1",
    x: 0,
    y: 0,
    width: 280,
    height: 80,
    z: 0,
    groupId: null,
    origin: "imported",
    createdAt: "2026-09-24T00:00:00.000Z",
    updatedAt: "2026-09-24T00:00:00.000Z",
    outputRevision: 1,
    output,
    ...extra,
  };
}

export function headers(origin: string, extra?: Record<string, string>): Record<string, string> {
  return {
    Authorization: `Bearer ${TEST_TOKEN}`,
    Origin: origin,
    "Content-Type": "application/json",
    ...extra,
  };
}

export type TestApp = {
  root: string;
  dataDir: string;
  projectsDir: string;
  homeDir: string;
  port: number;
  origin: string;
  baseUrl: string;
  backend: Backend;
  token: string;
};

export async function startTestApp(options?: {
  autosaveDelayMs?: number;
  now?: () => Date;
  accessLog?: (line: string) => void;
  executor?: ComfyExecutor;
  comfyReachability?: ComfyReachability;
  comfyBaseUrl?: string | null;
  cancelTimeoutMs?: number;
  cloudAdapters?: CloudVideoAdapter[];
  cloudPollIntervalMs?: number;
  cloudHeartbeatStaleMs?: number;
  cloudHeartbeatTickMs?: number;
  deriveVideo?: (input: {
    projectRoot: string;
    media: MediaRef;
    bytes: Uint8Array;
  }) => Promise<{ ok: true; media: MediaRef } | { ok: false }>;
  secretPresent?: (ref: { providerId: string; account?: string }) => boolean;
  secretStore?: SecretStore;
  allowRealComfy?: boolean;
  useLocalComfy?: boolean;
  fallbackExecutor?: ComfyExecutor;
  sshTunnel?: ComfyTunnel;
  reuse?: { root: string; dataDir: string; projectsDir: string; homeDir: string };
}): Promise<TestApp> {
  const root = options?.reuse?.root ?? (await mkdtemp(join(tmpdir(), "canvas-http-")));
  const dataDir = options?.reuse?.dataDir ?? join(root, "data");
  const projectsDir = options?.reuse?.projectsDir ?? join(root, "projects");
  const homeDir = options?.reuse?.homeDir ?? join(root, "home");
  if (options?.reuse === undefined) {
    await mkdir(dataDir, { recursive: true });
    await mkdir(projectsDir, { recursive: true });
    await mkdir(homeDir, { recursive: true });
  }
  const started = await startBackend({
    token: TEST_TOKEN,
    dataDir,
    ffmpeg: STUB_FFMPEG,
    homeDir,
    autosaveDelayMs: options?.autosaveDelayMs ?? 60_000,
    now: options?.now,
    accessLog: options?.accessLog,
    executor: options?.executor,
    comfyReachability: options?.comfyReachability,
    comfyBaseUrl: options?.comfyBaseUrl,
    cancelTimeoutMs: options?.cancelTimeoutMs,
    cloudAdapters: options?.cloudAdapters,
    cloudPollIntervalMs: options?.cloudPollIntervalMs,
    cloudHeartbeatStaleMs: options?.cloudHeartbeatStaleMs,
    cloudHeartbeatTickMs: options?.cloudHeartbeatTickMs,
    deriveVideo: options?.deriveVideo,
    secretPresent: options?.secretPresent,
    secretStore: options?.secretStore,
    allowRealComfy: options?.allowRealComfy,
    useLocalComfy: options?.useLocalComfy,
    fallbackExecutor: options?.fallbackExecutor,
    sshTunnel: options?.sshTunnel,
  });
  return {
    root,
    dataDir,
    projectsDir,
    homeDir,
    token: TEST_TOKEN,
    ...started,
  };
}

export async function closeTestApp(app: TestApp): Promise<void> {
  await app.backend.close();
}

export async function stopTestApp(app: TestApp): Promise<void> {
  await closeTestApp(app);
  await rm(app.root, { recursive: true, force: true, maxRetries: 8, retryDelay: 40 });
}

export async function createProject(
  app: TestApp,
  name = "demo",
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(`${app.baseUrl}/api/projects`, {
    method: "POST",
    headers: headers(app.origin),
    body: JSON.stringify({ parentDir: app.projectsDir, name }),
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}
