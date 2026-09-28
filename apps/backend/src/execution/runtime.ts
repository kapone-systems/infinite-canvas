/**
 * 方案 9.4 / 9.6 / 阶段 4–5：CapabilityService + 本地车道并发字面量 1。
 * 入队时快照槽与种子；submit 不得再读活节点。
 * 有 FakeExecutor 也不能跳过预检。
 */
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  applyStaleFrom,
  fingerprintNode,
  LANE_CONFIG,
  listCapabilities,
  listRecipes,
  markNodeStale,
  USER_FACING,
  type CapabilityDescriptor,
  type CapabilityService,
  type MediaRef,
  type Phase,
  type ProjectNode,
  type RecipeSummary,
  type ResultVersion,
  type RunEvent,
  type RunPlan,
  type RunRequest,
  type RunSnapshot,
  type RunState,
  type TaskRecord,
  type TaskState,
  type UserFacingError,
  type Variant,
  generationHasSettledSuccess,
  hasSucceededVariant,
  videoDerivativesReady,
} from "@canvas/schema";
import { ingestBytes } from "../media/ingest.ts";
import { absFromRel } from "../media/layout.ts";
import { deriveVideoWithFfmpeg, FFMPEG_MAX_RUN_MS } from "../media/videoDerive.ts";
import type { ProjectSession } from "../project/workingCopy.ts";
import { readAppJsonSync, writeAppJson } from "../appData.ts";
import { BACKEND_MESSAGES } from "../messages.ts";
import { redactSecret } from "../secrets/redactSecret.ts";
import { createMemorySecretStore } from "../secrets/memorySecretStore.ts";
import type { SecretStore } from "../secrets/types.ts";
import type { ComfyExecutor, ComfyImage, ComfyProbeResult, ComfyPromptInspect, ComfyReachability, ComfyWaitResult } from "./comfy/client.ts";
import { ComfyHttpExecutor, parseLocalComfyBaseUrl } from "./comfy/client.ts";
import {
  createFixtureVideoAdapter,
  createNeedsSecretAdapter,
  type CloudJobInspect,
  type CloudVideoAdapter,
} from "./adapters/exampleVideoFixture.ts";
import { bindRecipe } from "./bindRecipe.ts";
import { EventHub } from "./eventHub.ts";
import { generationHeightFor } from "./generationHeight.ts";
import {
  allocateSeeds,
  captureSlots,
  planRun as planExecution,
  type PlannedSnapshot,
} from "./planRun.ts";
import { loadRecipeById } from "./recipeLoader.ts";
import { runningProgressLabel } from "./progressLabel.ts";
import { TaskStoreError, type TaskStore } from "./taskStore.ts";

export class ExecutionHttpError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = "ExecutionHttpError";
  }
}

export type ComfyHealthStatus = "unconfigured" | "ok" | "unreachable";

export type ExecutionRuntime = CapabilityService & {
  dispose: () => void;
  comfyHealth: () => ComfyHealthStatus;
  getComfyBaseUrl: () => string | null;
  setComfyBaseUrl: (value: unknown) => Promise<{ ok: true; url: string | null } | { ok: false; message: string }>;
  probeComfy: () => Promise<ComfyProbeResult>;
  recheckComfy: () => Promise<ComfyProbeResult>;
  /** 设置页保存「使用本机 ComfyUI」时更换正在用的执行器。不写 app.json。 */
  setUseLocalComfy: (enabled: boolean) => void;
  getUseLocalComfy: () => boolean;
  usingRealComfy: () => boolean;
  lastCancelMessage: (taskId: string) => string | null;
  watchRun: (runId: string, signal: AbortSignal) => AsyncIterable<import("@canvas/schema").RunEvent>;
  /** 打开工程后：sqlite 里已对不上的 queued/running 不得继续显示运行中。 */
  reconcileOpenProject: () => void;
  /** 只重跑派生，不二次 submit。 */
  regeneratePreview: (nodeId: string) => Promise<{ ok: true } | { ok: false; message: string }>;
};

export type ExecutionRuntimeOptions = {
  store: TaskStore;
  session: ProjectSession;
  dataDir: string;
  executor?: ComfyExecutor;
  reachability: ComfyReachability;
  comfyBaseUrl?: string | null;
  now?: () => Date;
  cancelTimeoutMs?: number;
  cloudAdapters?: CloudVideoAdapter[];
  /** 测试把轮询间隔改小。未传则用配方 cloud.constraints.pollIntervalMs。 */
  cloudPollIntervalMs?: number;
  /**
   * 距上次云端 poll 回应超过这毫秒数，主句改心跳真话。
   * 生产 15000。不写进 app.json。测试注入更短窗口。
   */
  cloudHeartbeatStaleMs?: number;
  /** 挂着 poll 时检查 now() 的间隔。生产 1000。不要拿取消计时当心跳。 */
  cloudHeartbeatTickMs?: number;
  /** 注入派生。未传则走 ffmpeg；找不到时 ok: false，原件仍在。 */
  deriveVideo?: (input: { projectRoot: string; media: MediaRef; bytes: Uint8Array }) => Promise<{ ok: true; media: MediaRef } | { ok: false }>;
  /** 只在 requiresSecret 时调用。缺省改走 secretStore，不读测试注入以外的覆盖。 */
  secretPresent?: (ref: { providerId: string; account?: string }) => boolean;
  secretStore?: SecretStore;
  /**
   * 只有开关为开且进程没有 --fake-executor 才换成真 ComfyHttpExecutor。
   * 缺省关。现有测试不传这两项，仍用传入的替身。
   */
  allowRealComfy?: boolean;
  useLocalComfy?: boolean;
  fallbackExecutor?: ComfyExecutor;
};

type TaskSnapshot = PlannedSnapshot & {
  runId: string;
  retryVersionId?: string | null;
  retryIndexes?: number[];
};

const LOCAL_ACTIVE: TaskState[] = ["queued", "submitted", "running"];

type PendingRecover =
  | { kind: "local-images"; task: TaskRecord; images: ComfyImage[] }
  | { kind: "cloud-bytes"; task: TaskRecord; bytes: Uint8Array; mime: string };

type ActiveInspect =
  | { kind: "queued" | "running" }
  | { kind: "succeeded"; images?: ComfyImage[]; bytes?: Uint8Array; mime?: string }
  | { kind: "missing" }
  | { kind: "unreachable" };

function userError(code: string, message: string): UserFacingError {
  return { code, message };
}

function runStateFromTasks(tasks: readonly TaskRecord[]): RunState {
  if (tasks.some((task) => LOCAL_ACTIVE.includes(task.state))) {
    return "running";
  }
  const success = tasks.filter((task) => task.state === "succeeded" || task.state === "partial").length;
  const failed = tasks.filter((task) => task.state === "failed" || task.state === "interrupted").length;
  const cancelled = tasks.filter((task) => task.state === "cancelled").length;
  if (cancelled === tasks.length) {
    return "cancelled";
  }
  if (success === tasks.length) {
    return "succeeded";
  }
  if (success > 0) {
    return "partial";
  }
  if (failed > 0) {
    return "failed";
  }
  return "cancelled";
}

function summaryForRun(tasks: readonly TaskRecord[], fallback: string): string {
  const n = tasks.length;
  const failed = tasks.filter((task) => task.state === "failed" || task.state === "interrupted").length;
  if (n > 1 && failed > 0) {
    return USER_FACING.selectionPartial(n, failed);
  }
  if (tasks.every((task) => task.state === "succeeded" || task.state === "partial")) {
    return USER_FACING.generatingLabel;
  }
  const err = tasks.find((task) => task.error !== null)?.error?.message;
  return err ?? fallback;
}

function loadRecipeFn(id: string) {
  return loadRecipeById(id);
}

export function createExecutionRuntime(options: ExecutionRuntimeOptions): ExecutionRuntime {
  const store = options.store;
  const session = options.session;
  const reachability = options.reachability;
  const now = options.now ?? (() => new Date());
  const cancelTimeoutMs = options.cancelTimeoutMs ?? 10_000;
  const hub = new EventHub();
  const snapshots = new Map<string, TaskSnapshot>();
  const aborts = new Map<string, AbortController>();
  const promptIds = new Map<string, string>();
  const cancelling = new Set<string>();
  const cancelMessages = new Map<string, string>();
  const timeoutStarters = new Map<string, () => void>();
  const timeoutPromises = new Map<string, Promise<"timeout">>();
  let comfyBaseUrl = options.comfyBaseUrl ?? null;
  let useLocalComfy = options.useLocalComfy === true;
  const allowRealComfy = options.allowRealComfy === true;
  let executor: ComfyExecutor | undefined = options.executor;

  function installExecutor(): void {
    if (allowRealComfy && useLocalComfy) {
      executor = new ComfyHttpExecutor({ baseUrl: () => comfyBaseUrl });
    } else {
      executor = options.fallbackExecutor ?? options.executor;
    }
  }

  installExecutor();
  let lastProbe: ComfyProbeResult | null = null;
  let disposed = false;
  let pumping = false;
  let pumpAgain = false;
  let runningTaskId: string | null = null;
  let cloudPumping = false;
  let cloudPumpAgain = false;
  const localLimit: number = LANE_CONFIG.localConcurrency;
  const cloudLimit: number = LANE_CONFIG.cloudConcurrency;
  const cloudRunning = new Set<string>();
  /** 对上的任务。泵不得把它们捞回去 submit。 */
  const restoredLocal = new Set<string>();
  const restoredCloud = new Set<string>();
  const pendingRecover = new Map<string, PendingRecover>();
  const heartbeatTimers = new Set<ReturnType<typeof setInterval>>();
  const cloudHeartbeatStaleMs = options.cloudHeartbeatStaleMs ?? 15_000;
  const cloudHeartbeatTickMs = options.cloudHeartbeatTickMs ?? 1_000;
  const cancelResolvers = new Map<string, Array<() => void>>();
  const settledWaiters = new Map<string, Array<() => void>>();
  const cloudAdapters = options.cloudAdapters ?? [createFixtureVideoAdapter(), createNeedsSecretAdapter()];
  const secretStore = options.secretStore ?? createMemorySecretStore();

  function requireProject(): NonNullable<ProjectSession["current"]> {
    if (session.current === null) {
      throw new ExecutionHttpError(404, USER_FACING.noProject);
    }
    return session.current;
  }

  function publish(event: RunEvent): void {
    hub.publish(event);
  }

  function persist(events: RunEvent[], tasks?: Parameters<TaskStore["applyChanges"]>[0]["tasks"], run?: Parameters<TaskStore["applyChanges"]>[0]["run"]): RunSnapshot | null {
    if (disposed) {
      return null;
    }
    try {
      return store.applyChanges({ tasks, run, events, now: now().toISOString() });
    } catch (err) {
      if (err instanceof TaskStoreError && err.code === "CLOSED") {
        return null;
      }
      throw err;
    }
  }

  function queueLabel(taskId: string): string {
    const ahead = store.localAheadCount(taskId);
    if (ahead <= 0) {
      return USER_FACING.handingToLocalQueue;
    }
    return USER_FACING.localQueueAhead(ahead);
  }

  function timeoutFor(taskId: string): Promise<"timeout"> {
    const existing = timeoutPromises.get(taskId);
    if (existing !== undefined) {
      return existing;
    }
    const promise = new Promise<"timeout">((resolve) => {
      timeoutStarters.set(taskId, () => {
        setTimeout(() => resolve("timeout"), cancelTimeoutMs);
      });
    });
    timeoutPromises.set(taskId, promise);
    return promise;
  }

  function startCancelTimeout(taskId: string): void {
    timeoutFor(taskId);
    timeoutStarters.get(taskId)?.();
    timeoutStarters.delete(taskId);
  }

  function patchNode(
    nodeId: string,
    patch: Partial<ProjectNode>,
    bumpContent: boolean,
  ): { contentRevision: number; executionRevision: number; patch: Partial<ProjectNode> } | null {
    const applied = session.applyExecutionPatch(nodeId, patch, { bumpContentRevision: bumpContent });
    if (applied === null) {
      return null;
    }
    return {
      contentRevision: applied.contentRevision,
      executionRevision: applied.executionRevision,
      patch,
    };
  }

  function emitNodePatch(runId: string | null, nodeId: string, patch: Partial<ProjectNode>, bumpContent: boolean): void {
    if (disposed) {
      return;
    }
    const applied = patchNode(nodeId, patch, bumpContent);
    if (applied === null) {
      return;
    }
    const event: RunEvent = {
      type: "node.patch",
      runId,
      nodeId,
      contentRevision: applied.contentRevision,
      executionRevision: applied.executionRevision,
      patch: applied.patch,
    };
    persist([event]);
    publish(event);
  }

  function restartError(): UserFacingError {
    return {
      code: "RESTART_UNCERTAIN",
      message: USER_FACING.restartUncertain,
      detail: USER_FACING.resumeHint,
    };
  }

  function jobIdOf(task: TaskRecord): string | null {
    for (let i = task.variants.length - 1; i >= 0; i -= 1) {
      const id = task.variants[i]?.providerJobId;
      if (id != null && id.length > 0) {
        return id;
      }
    }
    return null;
  }

  function inspectActive(task: TaskRecord, jobId: string): ActiveInspect {
    if (task.lane === "cloud") {
      const loaded = loadRecipeById(task.recipeId);
      if (!loaded.ok) {
        return { kind: "missing" };
      }
      const adapter = adapterFor(loaded.recipe.adapterId);
      if (adapter?.inspect === undefined) {
        return { kind: "unreachable" };
      }
      const found: CloudJobInspect = adapter.inspect(jobId);
      if (found.kind === "succeeded") {
        return { kind: "succeeded", bytes: found.bytes, mime: found.mime };
      }
      return found;
    }
    if (executor?.inspectPrompt === undefined) {
      return { kind: "unreachable" };
    }
    const found: ComfyPromptInspect = executor.inspectPrompt(jobId);
    if (found.kind === "succeeded") {
      return { kind: "succeeded", images: found.images };
    }
    return found;
  }

  function markRestartUncertain(task: TaskRecord): void {
    const error = restartError();
    persist(
      [{ type: "task.finished", runId: task.runId, taskId: task.taskId, state: "interrupted", error }],
      [{ taskId: task.taskId, state: "interrupted", error }],
    );
  }

  function refreshRunAfterInterrupt(runId: string): void {
    const snapshot = store.getRun(runId);
    if (snapshot === null) {
      return;
    }
    const state = runStateFromTasks(snapshot.tasks);
    if (state === "running") {
      return;
    }
    const summary = restartError().message;
    const event: RunEvent = { type: "run.finished", runId, state, summary };
    persist([event], undefined, { runId, state, summary });
  }

  function leaveQueue(task: TaskRecord): void {
    if (task.state !== "queued") {
      return;
    }
    persist(
      [{ type: "task.running", runId: task.runId, taskId: task.taskId }],
      [{ taskId: task.taskId, state: "running" }],
    );
  }

  function holdSuccess(task: TaskRecord, verdict: ActiveInspect): void {
    leaveQueue(task);
    if (verdict.kind !== "succeeded") {
      return;
    }
    if (task.lane === "cloud") {
      pendingRecover.set(task.taskId, {
        kind: "cloud-bytes",
        task,
        bytes: verdict.bytes ?? new Uint8Array(),
        mime: verdict.mime ?? "video/mp4",
      });
      return;
    }
    pendingRecover.set(task.taskId, {
      kind: "local-images",
      task,
      images: verdict.images ?? [],
    });
  }

  function adoptRunning(task: TaskRecord, jobId: string): void {
    leaveQueue(task);
    promptIds.set(task.taskId, jobId);
    if (task.lane === "cloud") {
      restoredCloud.add(task.taskId);
      cloudRunning.add(task.taskId);
      void attachedCloud(task, jobId).finally(() => {
        cloudRunning.delete(task.taskId);
        restoredCloud.delete(task.taskId);
        if (!disposed) {
          scheduleCloudPump();
        }
      });
      return;
    }
    restoredLocal.add(task.taskId);
    const occupy = runningTaskId === null;
    if (occupy) {
      runningTaskId = task.taskId;
    }
    void attachedLocal(task, jobId).finally(() => {
      restoredLocal.delete(task.taskId);
      if (occupy && runningTaskId === task.taskId) {
        runningTaskId = null;
      }
      if (!disposed) {
        schedulePump();
      }
    });
  }

  function interruptOrphanedTasks(): void {
    let active: TaskRecord[] = [];
    try {
      active = [
        ...store.localActive(),
        ...store.listTasks({ lane: "cloud", states: ["queued", "submitted", "running"] }),
      ];
    } catch (err) {
      if (err instanceof TaskStoreError && err.code === "CLOSED") {
        return;
      }
      throw err;
    }
    const seen = new Set<string>();
    const uncertainRuns = new Set<string>();
    for (const task of active) {
      if (seen.has(task.taskId)) {
        continue;
      }
      seen.add(task.taskId);
      const jobId = jobIdOf(task);
      if (jobId === null) {
        markRestartUncertain(task);
        uncertainRuns.add(task.runId);
        continue;
      }
      let verdict: ActiveInspect;
      try {
        verdict = inspectActive(task, jobId);
      } catch {
        verdict = { kind: "unreachable" };
      }
      if (verdict.kind === "queued" || verdict.kind === "running") {
        adoptRunning(task, jobId);
        continue;
      }
      if (verdict.kind === "succeeded") {
        holdSuccess(task, verdict);
        continue;
      }
      markRestartUncertain(task);
      uncertainRuns.add(task.runId);
    }
    for (const runId of uncertainRuns) {
      refreshRunAfterInterrupt(runId);
    }
  }

  function generationRestingPhase(node: ProjectNode): Phase {
    if (generationHasSettledSuccess(node)) {
      return "succeeded";
    }
    return "idle";
  }

  function reconcileOpenProject(): void {
    const opened = session.current;
    if (opened === null) {
      return;
    }
    for (const taskId of [...pendingRecover.keys()]) {
      void drainRecover(taskId);
    }
    const error = restartError();
    const projectId = opened.project.projectId;
    let interrupted: TaskRecord[] = [];
    try {
      interrupted = store.listTasks({ states: ["interrupted"] }).filter(
        (task) => task.projectId === projectId && task.error?.code === "RESTART_UNCERTAIN",
      );
    } catch (err) {
      if (err instanceof TaskStoreError && err.code === "CLOSED") {
        return;
      }
      throw err;
    }
    for (const task of interrupted) {
      const node = opened.project.nodes[task.nodeId];
      if (node === undefined || node.kind !== "generation") {
        continue;
      }
      if (node.lastTaskId != null && node.lastTaskId.length > 0 && node.lastTaskId !== task.taskId) {
        continue;
      }
      const stillLive = LOCAL_ACTIVE.includes(task.state);
      if (stillLive) {
        continue;
      }
      const runningLike = node.phase === "queued" || node.phase === "running";
      if (!runningLike && node.lastError?.message === error.message) {
        continue;
      }
      emitNodePatch(task.runId, node.id, {
        phase: runningLike ? generationRestingPhase(node) : node.phase ?? "idle",
        lastError: error,
        progress: null,
      }, false);
    }
    for (const node of Object.values(opened.project.nodes)) {
      if (node.kind !== "generation") {
        continue;
      }
      if (node.phase !== "queued" && node.phase !== "running") {
        continue;
      }
      const taskId = node.lastTaskId;
      const task = taskId != null && taskId.length > 0 ? store.getTask(taskId) : null;
      if (taskId != null && (restoredLocal.has(taskId) || restoredCloud.has(taskId) || pendingRecover.has(taskId))) {
        if (node.phase !== "running") {
          emitNodePatch(node.lastRunId ?? null, node.id, {
            phase: "running",
            progress: {
              ratio: node.progress?.ratio ?? null,
              label: node.progress?.label ?? (node.runner === "cloud" ? USER_FACING.generatingLabel : USER_FACING.handingToLocalQueue),
            },
            lastError: null,
          }, false);
        }
        continue;
      }
      if (task !== null && LOCAL_ACTIVE.includes(task.state)) {
        continue;
      }
      emitNodePatch(node.lastRunId ?? null, node.id, {
        phase: generationRestingPhase(node),
        lastError: error,
        progress: null,
      }, false);
    }
  }

  function refreshQueuedLabels(): void {
    if (disposed) {
      return;
    }
    try {
      for (const task of store.localActive()) {
        if (task.state !== "queued") {
          continue;
        }
        const label = queueLabel(task.taskId);
        emitNodePatch(task.runId, task.nodeId, {
          progress: { ratio: null, label },
        }, false);
      }
    } catch (err) {
      if (err instanceof TaskStoreError && err.code === "CLOSED") {
        return;
      }
      throw err;
    }
  }

  async function probeComfy(): Promise<ComfyProbeResult> {
    if (comfyBaseUrl === null || comfyBaseUrl.length === 0) {
      lastProbe = { reachable: false, message: USER_FACING.comfyUnconfigured };
      return lastProbe;
    }
    const result = await reachability.probe(comfyBaseUrl);
    lastProbe = result.reachable
      ? { reachable: true, message: "" }
      : { reachable: false, message: result.message.length > 0 ? result.message : USER_FACING.comfyUnreachable };
    return lastProbe;
  }

  function comfyHealth(): ComfyHealthStatus {
    if (comfyBaseUrl === null || comfyBaseUrl.length === 0) {
      return "unconfigured";
    }
    if (lastProbe !== null && !lastProbe.reachable) {
      return "unreachable";
    }
    return "ok";
  }

  async function setComfyBaseUrl(value: unknown): Promise<{ ok: true; url: string | null } | { ok: false; message: string }> {
    const parsed = parseLocalComfyBaseUrl(value);
    if (!parsed.ok) {
      return { ok: false, message: BACKEND_MESSAGES.requestFailed };
    }
    comfyBaseUrl = parsed.url;
    lastProbe = null;
    await writeAppJson(options.dataDir, { comfyBaseUrl });
    return { ok: true, url: comfyBaseUrl };
  }

  function setUseLocalComfy(enabled: boolean): void {
    useLocalComfy = enabled;
    installExecutor();
  }

  function buildPlan(request: RunRequest): ReturnType<typeof planExecution> {
    const opened = requireProject();
    if (opened.project.projectId !== request.projectId) {
      throw new ExecutionHttpError(400, USER_FACING.workingCopySyncFailed);
    }
    return planExecution({
      request,
      nodes: opened.project.nodes,
      edges: opened.project.edges,
      loadRecipe: loadRecipeFn,
      secretPresent: options.secretPresent ?? ((ref) => secretStore.presentSync(ref)),
    });
  }

  async function readSnapMedia(relativePath: string): Promise<Uint8Array> {
    const opened = session.current;
    if (opened === null) {
      throw new Error("no project");
    }
    const abs = absFromRel(opened.absolutePath, relativePath);
    const buf = await readFile(abs);
    return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  }

  function taskFailedOrSkipped(state: TaskState): boolean {
    return state === "failed" || state === "cancelled" || state === "interrupted";
  }

  function dependsOnBlocked(snap: TaskSnapshot, run: RunSnapshot): "wait" | "skip" | "ok" {
    for (const nodeId of snap.dependsOnNodeIds) {
      const dep = run.tasks.find((task) => task.nodeId === nodeId);
      if (dep === undefined) {
        continue;
      }
      if (LOCAL_ACTIVE.includes(dep.state)) {
        return "wait";
      }
      if (taskFailedOrSkipped(dep.state)) {
        return "skip";
      }
    }
    return "ok";
  }

  async function startRun(request: RunRequest): Promise<RunSnapshot> {
    const existing = store.getRunByClientRequestId(request.projectId, request.clientRequestId);
    if (existing !== null) {
      return existing;
    }
    const planned = buildPlan(request);
    if (!planned.ok) {
      throw new ExecutionHttpError(400, planned.message);
    }
    const { plan, runnable } = planned;
    if (runnable.length === 0) {
      return {
        runId: request.clientRequestId,
        projectId: request.projectId,
        scope: request.scope,
        force: request.force,
        state: "succeeded",
        plan,
        tasks: [],
        summary: plan.summary,
      };
    }
    const needsLocal = runnable.some((item) => item.recipe.lane !== "cloud");
    if (needsLocal) {
      if (comfyBaseUrl === null || comfyBaseUrl.length === 0) {
        throw new ExecutionHttpError(400, USER_FACING.comfyUnconfigured);
      }
      const probe = await probeComfy();
      if (!probe.reachable) {
        throw new ExecutionHttpError(400, probe.message);
      }
    }
    const runId = randomUUID();
    const iso = now().toISOString();
    const cloudOnly = runnable.every((item) => item.recipe.lane === "cloud");
    const queuedSummary = cloudOnly ? USER_FACING.generatingLabel : USER_FACING.handingToLocalQueue;
    const tasks = runnable.map((item) => {
      const taskId = randomUUID();
      snapshots.set(taskId, { ...item, runId });
      return {
        taskId,
        nodeId: item.nodeId,
        lane: item.recipe.lane,
        recipeId: item.recipe.id,
        recipeVersion: item.recipe.version,
        fingerprintAtStart: item.fingerprint,
        variants: item.seeds.map((_, index) => ({
          index,
          state: "queued",
          seedUsed: null,
          outputs: [] as MediaRef[],
          error: null,
          providerJobId: null,
        })),
      };
    });
    const snapshot = store.insertQueued({
      runId,
      projectId: request.projectId,
      clientRequestId: request.clientRequestId,
      scope: request.scope,
      force: request.force,
      plan,
      summary: queuedSummary,
      tasks,
      now: iso,
    });
    for (const event of store.listEvents(runId)) {
      publish(event);
    }
    for (const task of snapshot.tasks) {
      const label = task.lane === "cloud" ? USER_FACING.generatingLabel : queueLabel(task.taskId);
      emitNodePatch(runId, task.nodeId, {
        phase: "queued",
        lastRunId: runId,
        lastTaskId: task.taskId,
        lastAttemptFingerprint: task.fingerprintAtStart,
        runner: task.lane === "cloud" ? "cloud" : "local",
        progress: { ratio: null, label },
        lastError: null,
        inputsChangedWhileRunning: false,
      }, false);
    }
    schedulePump();
    scheduleCloudPump();
    return store.getRun(runId) ?? snapshot;
  }

  function schedulePump(): void {
    pumpAgain = true;
    if (pumping) {
      return;
    }
    pumping = true;
    setImmediate(() => {
      void (async () => {
        try {
          while (!disposed) {
            pumpAgain = false;
            const occupied = runningTaskId !== null ? 1 : 0;
            if (occupied >= localLimit) {
              break;
            }
            let next: TaskRecord | undefined;
            try {
              const queued = store.localActive().filter((task) => task.state === "queued" && !cancelling.has(task.taskId) && !restoredLocal.has(task.taskId));
              for (const task of queued) {
                const snap = snapshots.get(task.taskId);
                const run = store.getRun(task.runId);
                if (snap !== undefined && run !== null) {
                  const blocked = dependsOnBlocked(snap, run);
                  if (blocked === "skip") {
                    await finishSkippedUpstream(task, snap);
                    continue;
                  }
                  if (blocked === "wait") {
                    continue;
                  }
                }
                next = task;
                break;
              }
            } catch (err) {
              if (err instanceof TaskStoreError && err.code === "CLOSED") {
                break;
              }
              throw err;
            }
            if (next === undefined) {
              if (pumpAgain) {
                continue;
              }
              break;
            }
            runningTaskId = next.taskId;
            try {
              await submitAndWait(next);
            } finally {
              runningTaskId = null;
            }
            if (disposed) {
              break;
            }
            refreshQueuedLabels();
            scheduleCloudPump();
          }
        } finally {
          pumping = false;
          if (pumpAgain && !disposed) {
            schedulePump();
          }
        }
      })();
    });
  }

  async function submitAndWait(task: TaskRecord): Promise<void> {
    if (disposed) {
      return;
    }
    if (restoredLocal.has(task.taskId)) {
      return;
    }
    const snap = snapshots.get(task.taskId);
    if (snap === undefined) {
      await failTask(task, userError("RESTART_UNCERTAIN", USER_FACING.restartUncertain));
      return;
    }
    if (cancelling.has(task.taskId)) {
      await finishCancelled(task, snap);
      return;
    }
    if (executor === undefined) {
      await failTask(task, userError("GENERATION_INCOMPLETE", USER_FACING.generationIncomplete));
      return;
    }
    const runningExecutor = executor;
    const indexes = snap.retryIndexes ?? snap.seeds.map((_, i) => i);
    const iso0 = now().toISOString();
    let variants: Variant[];
    if (snap.retryVersionId) {
      const live = session.current?.project.nodes[task.nodeId];
      const existing = live?.versions?.find((item) => item.id === snap.retryVersionId);
      if (existing !== undefined) {
        variants = existing.variants.map((item) => structuredClone(item));
      } else {
        variants = indexes.map((index) => ({
          id: randomUUID(),
          index,
          phase: "queued" as const,
          seedUsed: snap.seeds[index] ?? null,
          output: null,
          text: null,
          error: null,
          createdAt: iso0,
        }));
      }
    } else {
      variants = Array.from({ length: snap.variantCount }, (_, index) => ({
        id: randomUUID(),
        index,
        phase: "queued" as const,
        seedUsed: null,
        output: null,
        text: null,
        error: null,
        createdAt: iso0,
      }));
    }
    const runningLabel = runningProgressLabel("KSampler");
    emitNodePatch(task.runId, task.nodeId, {
      phase: "running",
      progress: { ratio: null, label: runningLabel },
    }, false);

    let tooLate = false;
    let thumbFailed = false;
    let lastFail: UserFacingError | null = null;
    let submittedAny = false;

    for (const index of indexes) {
      if (disposed) {
        return;
      }
      if (cancelling.has(task.taskId)) {
        await finishCancelled(task, snap);
        return;
      }
      const seedUsed = snap.seeds[index] ?? 0;
      const bound = await bindRecipe({
        recipe: snap.recipe,
        slots: snap.slots,
        params: snap.params,
        seedUsed,
        uploadImage: async (bytes, mime) => {
          const result = await runningExecutor.uploadImage({ bytes, mime });
          return result.name;
        },
        readMedia: readSnapMedia,
      });
      if (!bound.ok) {
        lastFail = userError("COMFY_UPLOAD_FAILED", bound.message);
        markRemainingFailed(variants, index, indexes, lastFail, iso0);
        break;
      }
      let submitted;
      try {
        submitted = await runningExecutor.submit({
          taskId: task.taskId,
          promptText: snap.promptText,
          prompt: bound.prompt,
          variantIndex: index,
        });
      } catch {
        lastFail = userError("COMFY_REJECTED", USER_FACING.comfyRejected);
        markRemainingFailed(variants, index, indexes, lastFail, iso0);
        break;
      }
      submittedAny = true;
      promptIds.set(task.taskId, submitted.promptId);
      persist(
        [{ type: "task.submitted", runId: task.runId, taskId: task.taskId, providerJobId: submitted.promptId }],
        [
          {
            taskId: task.taskId,
            state: "submitted",
            variants: variantsToTask(variants, submitted.promptId, index, seedUsed),
          },
        ],
      );
      const abort = new AbortController();
      aborts.set(task.taskId, abort);
      persist([{ type: "task.running", runId: task.runId, taskId: task.taskId }], [{ taskId: task.taskId, state: "running" }]);
      publish({ type: "task.submitted", runId: task.runId, taskId: task.taskId, providerJobId: submitted.promptId });
      publish({ type: "task.running", runId: task.runId, taskId: task.taskId });
      const waitPromise = runningExecutor.wait(submitted.promptId, abort.signal);
      const raced = await Promise.race([waitPromise, timeoutFor(task.taskId)]);
      if (disposed) {
        return;
      }
      if (raced === "timeout") {
        await finishUncertain(task, snap);
        return;
      }
      if (raced.ok) {
        tooLate = tooLate || cancelling.has(task.taskId);
        const landed = await ingestVariantImage(task, raced.images);
        if (!landed.ok) {
          lastFail = landed.error;
          markRemainingFailed(variants, index, indexes, lastFail, iso0);
          break;
        }
        thumbFailed = thumbFailed || landed.thumbFailed;
        const iso = now().toISOString();
        const variant: Variant = {
          id: variants[index]?.id ?? randomUUID(),
          index,
          phase: "succeeded",
          seedUsed,
          output: landed.media,
          text: null,
          error: null,
          createdAt: iso,
        };
        variants[index] = variant;
        await writeVariantProgress(task, snap, variants, variant, tooLate, false);
        continue;
      }
      if (raced.code === "cancelled" || cancelling.has(task.taskId)) {
        await finishCancelled(task, snap);
        return;
      }
      const message =
        raced.code === "rejected"
          ? USER_FACING.comfyRejected
          : raced.code === "no-image"
            ? USER_FACING.comfyNoImage
            : raced.message;
      lastFail = userError("GENERATION_INCOMPLETE", message);
      markRemainingFailed(variants, index, indexes, lastFail, now().toISOString());
      break;
    }

    void submittedAny;
    const successCount = variants.filter((item) => item.phase === "succeeded").length;
    if (successCount === 0) {
      await failTask(task, lastFail ?? userError("GENERATION_INCOMPLETE", USER_FACING.generationIncomplete));
      return;
    }
    await finalizeVariants(task, snap, variants, tooLate, thumbFailed, lastFail);
  }

  function markRemainingFailed(
    variants: Variant[],
    failedIndex: number,
    indexes: readonly number[],
    error: UserFacingError,
    iso: string,
  ): void {
    const remaining = new Set(indexes.filter((i) => i >= failedIndex));
    for (let i = 0; i < variants.length; i += 1) {
      const current = variants[i];
      if (current === undefined || current.phase === "succeeded") {
        continue;
      }
      if (i === failedIndex || remaining.has(i) || current.phase === "queued" || current.phase === "running") {
        variants[i] = {
          ...current,
          phase: "failed",
          error,
          createdAt: iso,
        };
      }
    }
  }

  function variantsToTask(
    variants: Variant[],
    providerJobId: string | null,
    runningIndex: number,
    seedUsed: number,
  ): TaskRecord["variants"] {
    return variants.map((item) => ({
      index: item.index,
      state: item.index === runningIndex ? "running" : item.phase,
      seedUsed: item.index === runningIndex ? seedUsed : item.seedUsed,
      outputs: item.output !== null ? [item.output] : [],
      error: item.error,
      providerJobId: item.index === runningIndex ? providerJobId : null,
    }));
  }

  async function ingestVariantImage(
    task: TaskRecord,
    images: Array<{ bytes: Uint8Array; mime: string }>,
  ): Promise<{ ok: true; media: import("@canvas/schema").MediaRef; thumbFailed: boolean } | { ok: false; error: UserFacingError }> {
    const opened = session.current;
    if (opened === null) {
      return { ok: false, error: userError("INGEST_FAILED", USER_FACING.ingestFailed) };
    }
    const image = images[0];
    if (image === undefined) {
      return { ok: false, error: userError("COMFY_NO_IMAGE", USER_FACING.comfyNoImage) };
    }
    const ingested = await ingestBytes({
      projectRoot: opened.absolutePath,
      bytes: image.bytes,
      originalFileName: `${task.taskId}.png`,
      source: "generation",
      taskId: task.taskId,
      now,
    });
    if (!ingested.ok) {
      return { ok: false, error: userError("INGEST_FAILED", ingested.message) };
    }
    return { ok: true, media: ingested.media, thumbFailed: ingested.thumb === "failed" };
  }

  async function writeVariantProgress(
    task: TaskRecord,
    snap: TaskSnapshot,
    variants: Variant[],
    lastVariant: Variant,
    tooLate: boolean,
    done: boolean,
  ): Promise<void> {
    const opened = session.current;
    if (opened === null) {
      return;
    }
    const liveNode = opened.project.nodes[task.nodeId];
    if (liveNode === undefined) {
      return;
    }
    const iso = now().toISOString();
    let versions = [...(liveNode.versions ?? [])];
    let versionId = snap.retryVersionId ?? (snap as TaskSnapshot & { versionId?: string }).versionId;
    if (versionId != null && versions.some((item) => item.id === versionId)) {
      versions = versions.map((item) =>
        item.id === versionId ? { ...item, variants: variants.map((row) => structuredClone(row)) } : item,
      );
    } else {
      const version: ResultVersion = {
        id: randomUUID(),
        createdAt: iso,
        fingerprint: snap.fingerprint,
        recipeId: snap.recipe.id,
        recipeVersion: snap.recipe.version,
        paramSnapshot: { ...snap.params },
        variantCountRequested: snap.variantCount,
        variants: variants.map((row) => structuredClone(row)),
      };
      versionId = version.id;
      (snap as TaskSnapshot & { versionId?: string }).versionId = version.id;
      versions = [...versions, version];
    }
    const liveFp = fingerprintNode(liveNode, opened.project.nodes, opened.project.edges);
    const changed = liveFp !== snap.fingerprint;
    const success = variants.filter((item) => item.phase === "succeeded");
    const lastSuccess = success.at(-1) ?? lastVariant;
    const failedCount = variants.filter((item) => item.phase === "failed").length;
    let lastError: UserFacingError | null = null;
    if (changed) {
      lastError = userError("INPUTS_CHANGED", USER_FACING.inputsChangedAfterRun);
    } else if (tooLate) {
      lastError = userError("TOO_LATE_TO_CANCEL", USER_FACING.tooLateToCancel);
    } else if (done && failedCount > 0 && success.length > 0) {
      lastError = userError("PARTIAL_SUCCESS", USER_FACING.partialSuccess(variants.length, success.length));
    }
    if (tooLate) {
      cancelMessages.set(task.taskId, USER_FACING.tooLateToCancel);
    }
    const patched: Partial<ProjectNode> = {
      phase: done ? "succeeded" : "running",
      freshness: changed ? "stale" : "fresh",
      versions,
      currentVersionId: versionId,
      activeVariantId: lastSuccess.id,
      output: lastSuccess.output,
      outputRevision: (liveNode.outputRevision ?? 1) + 1,
      lastSuccessFingerprint: changed ? (liveNode.lastSuccessFingerprint ?? null) : snap.fingerprint,
      lastAttemptFingerprint: snap.fingerprint,
      lastError,
      progress: done ? null : {
        ratio: null,
        label: task.lane === "cloud" ? USER_FACING.generatingLabel : runningProgressLabel("KSampler"),
      },
      runner: task.lane === "cloud" ? "cloud" : "local",
      inputsChangedWhileRunning: changed,
      lastRunId: task.runId,
      lastTaskId: task.taskId,
    };
    patched.height = generationHeightFor({
      slots: liveNode.slots,
      versions,
      currentVersionId: versionId,
    });
    const finished: RunEvent = {
      type: "variant.finished",
      runId: task.runId,
      taskId: task.taskId,
      nodeId: task.nodeId,
      variant: lastVariant,
    };
    persist([finished], [
      {
        taskId: task.taskId,
        state: done ? (failedCount > 0 ? "partial" : "running") : "running",
        variants: variants.map((item) => ({
          index: item.index,
          state: item.phase,
          seedUsed: item.seedUsed,
          outputs: item.output !== null ? [item.output] : [],
          error: item.error,
          providerJobId: promptIds.get(task.taskId) ?? null,
        })),
      },
    ]);
    publish(finished);
    emitNodePatch(task.runId, task.nodeId, patched, true);
    if (changed) {
      const after = opened.project.nodes[task.nodeId];
      if (after !== undefined) {
        opened.project.nodes[task.nodeId] = markNodeStale(after);
      }
    }
    applyStaleFrom(opened.project.nodes, opened.project.edges, task.nodeId);
    await session.flushAutosave();
  }

  async function finalizeVariants(
    task: TaskRecord,
    snap: TaskSnapshot,
    variants: Variant[],
    tooLate: boolean,
    thumbFailed: boolean,
    lastFail: UserFacingError | null,
  ): Promise<void> {
    const lastSuccess = [...variants].reverse().find((item) => item.phase === "succeeded");
    if (lastSuccess === undefined) {
      await failTask(task, lastFail ?? userError("GENERATION_INCOMPLETE", USER_FACING.generationIncomplete));
      return;
    }
    await writeVariantProgress(task, snap, variants, lastSuccess, tooLate, true);
    const failedCount = variants.filter((item) => item.phase === "failed").length;
    const taskState: TaskState = failedCount > 0 || thumbFailed ? "partial" : "succeeded";
    persist(
      [{ type: "task.finished", runId: task.runId, taskId: task.taskId, state: taskState, error: null }],
      [{ taskId: task.taskId, state: taskState, error: null }],
    );
    publish({ type: "task.finished", runId: task.runId, taskId: task.taskId, state: taskState, error: null });
    emitNodePatch(task.runId, task.nodeId, {
      phase: "succeeded",
      progress: null,
    }, false);
    await finishRun(task.runId, task.taskId, taskState, null);
  }

  function taskStillOpen(taskId: string): boolean {
    const latest = store.getTask(taskId);
    return latest !== null && LOCAL_ACTIVE.includes(latest.state);
  }

  async function failTask(task: TaskRecord, error: UserFacingError): Promise<void> {
    if (disposed || !taskStillOpen(task.taskId)) {
      return;
    }
    persist(
      [{ type: "task.finished", runId: task.runId, taskId: task.taskId, state: "failed", error }],
      [{ taskId: task.taskId, state: "failed", error }],
    );
    publish({ type: "task.finished", runId: task.runId, taskId: task.taskId, state: "failed", error });
    emitNodePatch(task.runId, task.nodeId, {
      phase: "failed",
      lastError: error,
      progress: null,
      lastRunId: task.runId,
      lastTaskId: task.taskId,
    }, false);
    await finishRun(task.runId, task.taskId, "failed", error);
  }

  function phaseAfterCancel(snap: TaskSnapshot, node: ProjectNode | undefined): Phase {
    if (node !== undefined && generationHasSettledSuccess(node)) {
      return "succeeded";
    }
    return snap.phaseBefore;
  }

  async function finishSkippedUpstream(task: TaskRecord, snap: TaskSnapshot): Promise<void> {
    if (disposed || !taskStillOpen(task.taskId)) {
      return;
    }
    const error = userError("UPSTREAM_NOT_RUN", USER_FACING.upstreamNotRun);
    persist(
      [{ type: "task.finished", runId: task.runId, taskId: task.taskId, state: "cancelled", error }],
      [{ taskId: task.taskId, state: "cancelled", error }],
    );
    publish({ type: "task.finished", runId: task.runId, taskId: task.taskId, state: "cancelled", error });
    emitNodePatch(task.runId, task.nodeId, {
      phase: snap.phaseBefore,
      lastError: error,
      progress: null,
      lastRunId: task.runId,
      lastTaskId: task.taskId,
    }, false);
    await finishRun(task.runId, task.taskId, "cancelled", error);
  }

  async function finishCancelled(task: TaskRecord, snap: TaskSnapshot): Promise<void> {
    if (disposed || !taskStillOpen(task.taskId)) {
      return;
    }
    const error = userError("CANCELLED", USER_FACING.cancelledNoResult);
    cancelMessages.set(task.taskId, USER_FACING.cancelledNoResult);
    persist(
      [{ type: "task.finished", runId: task.runId, taskId: task.taskId, state: "cancelled", error }],
      [{ taskId: task.taskId, state: "cancelled", error }],
    );
    publish({ type: "task.finished", runId: task.runId, taskId: task.taskId, state: "cancelled", error });
    const node = session.current?.project.nodes[task.nodeId];
    emitNodePatch(task.runId, task.nodeId, {
      phase: phaseAfterCancel(snap, node),
      lastError: error,
      progress: null,
      lastRunId: task.runId,
      lastTaskId: task.taskId,
    }, false);
    await finishRun(task.runId, task.taskId, "cancelled", error);
  }

  async function finishUncertain(task: TaskRecord, snap: TaskSnapshot): Promise<void> {
    if (disposed || !taskStillOpen(task.taskId)) {
      return;
    }
    const error = userError("CANCEL_UNCERTAIN", USER_FACING.cancelUncertain);
    cancelMessages.set(task.taskId, USER_FACING.cancelUncertain);
    persist(
      [{ type: "task.finished", runId: task.runId, taskId: task.taskId, state: "interrupted", error }],
      [{ taskId: task.taskId, state: "interrupted", error }],
    );
    publish({ type: "task.finished", runId: task.runId, taskId: task.taskId, state: "interrupted", error });
    const node = session.current?.project.nodes[task.nodeId];
    emitNodePatch(task.runId, task.nodeId, {
      phase: phaseAfterCancel(snap, node),
      lastError: error,
      progress: null,
    }, false);
    await finishRun(task.runId, task.taskId, "interrupted", error);
  }

  async function finishStoppedWaiting(task: TaskRecord, snap: TaskSnapshot): Promise<void> {
    if (disposed || !taskStillOpen(task.taskId)) {
      return;
    }
    const error: UserFacingError = {
      code: "CLOUD_WAIT_STOPPED",
      message: USER_FACING.stoppedWaiting,
      detail: USER_FACING.cloudCancelMayFinish,
    };
    cancelMessages.set(task.taskId, USER_FACING.stoppedWaiting);
    persist(
      [{ type: "task.finished", runId: task.runId, taskId: task.taskId, state: "interrupted", error }],
      [{ taskId: task.taskId, state: "interrupted", error }],
    );
    publish({ type: "task.finished", runId: task.runId, taskId: task.taskId, state: "interrupted", error });
    const node = session.current?.project.nodes[task.nodeId];
    emitNodePatch(task.runId, task.nodeId, {
      phase: phaseAfterCancel(snap, node),
      lastError: error,
      progress: null,
    }, false);
    await finishRun(task.runId, task.taskId, "interrupted", error);
  }

  async function finishCloudUnclear(task: TaskRecord, snap: TaskSnapshot): Promise<void> {
    if (snap.recipe.requiresSecret) {
      await finishStoppedWaiting(task, snap);
      return;
    }
    await finishUncertain(task, snap);
  }

  async function finishRun(runId: string, taskId: string, taskState: TaskState, error: UserFacingError | null): Promise<void> {
    if (disposed) {
      return;
    }
    const snapshot = store.getRun(runId);
    if (snapshot === null) {
      return;
    }
    const state = runStateFromTasks(snapshot.tasks);
    const summary = state === "running" ? snapshot.summary : summaryForRun(snapshot.tasks, snapshot.summary);
    if (state !== "running") {
      const event: RunEvent = { type: "run.finished", runId, state, summary };
      persist([event], undefined, { runId, state, summary });
      publish(event);
    }
    aborts.delete(taskId);
    promptIds.delete(taskId);
    const waiters = settledWaiters.get(taskId) ?? [];
    settledWaiters.delete(taskId);
    for (const resolve of waiters) {
      resolve();
    }
    void taskState;
    void error;
  }

  async function cancelTask(taskId: string): Promise<TaskRecord> {
    const task = store.getTask(taskId);
    if (task === null) {
      throw new ExecutionHttpError(404, USER_FACING.cancelUncertain);
    }
    if (task.state === "succeeded" || task.state === "partial") {
      cancelMessages.set(taskId, USER_FACING.tooLateToCancel);
      return task;
    }
    if (task.state === "failed" || task.state === "cancelled" || task.state === "interrupted") {
      return task;
    }
    const snap = snapshots.get(taskId);
    if (task.state === "queued") {
      if (snap !== undefined) {
        await finishCancelled(task, snap);
      } else {
        await failTask(task, userError("CANCEL_UNCERTAIN", USER_FACING.cancelUncertain));
      }
      schedulePump();
      const latest = store.getTask(taskId);
      if (latest === null) {
        throw new ExecutionHttpError(404, USER_FACING.cancelUncertain);
      }
      return latest;
    }
    cancelling.add(taskId);
    cancelMessages.set(taskId, USER_FACING.cancelling);
    emitNodePatch(task.runId, task.nodeId, {
      progress: { ratio: null, label: USER_FACING.cancelling },
    }, false);
    if (task.lane === "cloud") {
      fireCancel(taskId);
      aborts.get(taskId)?.abort();
      startCancelTimeout(taskId);
      await new Promise<void>((resolve) => {
        if (!taskStillOpen(taskId)) {
          resolve();
          return;
        }
        const list = settledWaiters.get(taskId) ?? [];
        list.push(resolve);
        settledWaiters.set(taskId, list);
        setTimeout(resolve, cancelTimeoutMs + 50);
      });
      const latestCloud = store.getTask(taskId);
      if (latestCloud === null) {
        throw new ExecutionHttpError(404, USER_FACING.cancelUncertain);
      }
      return latestCloud;
    }
    aborts.get(taskId)?.abort();
    const promptId = promptIds.get(taskId);
    if (promptId !== undefined && executor !== undefined) {
      await executor.interrupt(promptId);
    }
    startCancelTimeout(taskId);
    schedulePump();
    const latest = store.getTask(taskId);
    if (latest === null) {
      throw new ExecutionHttpError(404, USER_FACING.cancelUncertain);
    }
    return latest;
  }

  async function cancelRun(runId: string): Promise<RunSnapshot> {
    const snapshot = store.getRun(runId);
    if (snapshot === null) {
      throw new ExecutionHttpError(404, USER_FACING.restartUncertain);
    }
    for (const task of snapshot.tasks) {
      if (LOCAL_ACTIVE.includes(task.state)) {
        await cancelTask(task.taskId);
      }
    }
    return store.getRun(runId) ?? snapshot;
  }

  async function retryFailed(runId: string): Promise<RunSnapshot> {
    const snapshot = store.getRun(runId);
    if (snapshot === null) {
      throw new ExecutionHttpError(404, USER_FACING.restartUncertain);
    }
    const opened = requireProject();
    const { nodes, edges } = opened.project;
    const queued: Array<TaskSnapshot & { retryVersionId: string; retryIndexes: number[] }> = [];
    for (const task of snapshot.tasks) {
      const node = nodes[task.nodeId];
      if (node === undefined || node.kind !== "generation") {
        continue;
      }
      const fp = fingerprintNode(node, nodes, edges);
      if (fp !== task.fingerprintAtStart) {
        throw new ExecutionHttpError(400, USER_FACING.retryFailedInputsChanged);
      }
      const version = (node.versions ?? []).find((item) => item.id === node.currentVersionId);
      if (version === undefined) {
        continue;
      }
      const retryIndexes = version.variants.filter((item) => item.phase === "failed").map((item) => item.index);
      if (retryIndexes.length === 0) {
        continue;
      }
      const loaded = loadRecipeById(node.recipeId ?? "");
      if (!loaded.ok) {
        throw new ExecutionHttpError(400, loaded.message);
      }
      const seeds = version.variants.map((item, index) => {
        if (item.seedUsed != null) {
          return item.seedUsed >>> 0;
        }
        return allocateSeeds(node.params ?? {}, version.variantCountRequested)[index] ?? 0;
      });
      queued.push({
        promptText: captureSlots(node, nodes, edges).find((slot) => slot.role === "prompt")?.text ?? "",
        fingerprint: fp,
        params: { ...(node.params ?? {}) },
        recipe: loaded.recipe,
        phaseBefore: node.phase ?? "succeeded",
        variantCount: version.variantCountRequested,
        nodeId: node.id,
        slots: captureSlots(node, nodes, edges),
        seeds,
        usesStaleUpstream: false,
        dependsOnNodeIds: [],
        runId: "",
        retryVersionId: version.id,
        retryIndexes,
      });
    }
    if (queued.length === 0) {
      return snapshot;
    }
    const needsLocal = queued.some((item) => item.recipe.lane !== "cloud");
    if (needsLocal) {
      if (comfyBaseUrl === null || comfyBaseUrl.length === 0) {
        throw new ExecutionHttpError(400, USER_FACING.comfyUnconfigured);
      }
      const probe = await probeComfy();
      if (!probe.reachable) {
        throw new ExecutionHttpError(400, probe.message);
      }
    }
    const newRunId = randomUUID();
    const iso = now().toISOString();
    const tasks = queued.map((item) => {
      const taskId = randomUUID();
      snapshots.set(taskId, { ...item, runId: newRunId });
      return {
        taskId,
        nodeId: item.nodeId,
        lane: item.recipe.lane,
        recipeId: item.recipe.id,
        recipeVersion: item.recipe.version,
        fingerprintAtStart: item.fingerprint,
        variants: item.seeds.map((_, index) => ({
          index,
          state: item.retryIndexes.includes(index) ? "queued" : "succeeded",
          seedUsed: item.seeds[index] ?? null,
          outputs: [] as import("@canvas/schema").MediaRef[],
          error: null,
          providerJobId: null,
        })),
      };
    });
    const plan: RunPlan = {
      nodes: queued.map((item) => ({
        nodeId: item.nodeId,
        action: "run" as const,
        message: USER_FACING.handingToLocalQueue,
      })),
      summary: USER_FACING.handingToLocalQueue,
    };
    const inserted = store.insertQueued({
      runId: newRunId,
      projectId: snapshot.projectId,
      clientRequestId: `retry-${runId}-${iso}`,
      scope: snapshot.scope,
      force: false,
      plan,
      summary: USER_FACING.handingToLocalQueue,
      tasks,
      now: iso,
    });
    for (const event of store.listEvents(newRunId)) {
      publish(event);
    }
    for (const task of inserted.tasks) {
      emitNodePatch(newRunId, task.nodeId, {
        phase: "queued",
        lastRunId: newRunId,
        lastTaskId: task.taskId,
        lastAttemptFingerprint: task.fingerprintAtStart,
        runner: task.lane === "cloud" ? "cloud" : "local",
        progress: { ratio: null, label: task.lane === "cloud" ? USER_FACING.generatingLabel : queueLabel(task.taskId) },
        lastError: null,
      }, false);
    }
    schedulePump();
    scheduleCloudPump();
    return store.getRun(newRunId) ?? inserted;
  }

  async function resumeWork(runId: string): Promise<RunSnapshot> {
    const snapshot = store.getRun(runId);
    if (snapshot === null) {
      throw new ExecutionHttpError(404, USER_FACING.restartUncertain);
    }
    const opened = session.current;
    if (opened === null) {
      return snapshot;
    }
    const queued: Array<TaskSnapshot & { retryVersionId: string; retryIndexes: number[] }> = [];
    for (const task of snapshot.tasks) {
      if (task.state !== "interrupted") {
        continue;
      }
      const node = opened.project.nodes[task.nodeId];
      if (node === undefined || node.kind !== "generation") {
        continue;
      }
      const fp = fingerprintNode(node, opened.project.nodes, opened.project.edges);
      if (fp !== task.fingerprintAtStart) {
        continue;
      }
      const retryIndexes = task.variants
        .filter((item) => item.state !== "succeeded")
        .map((item) => item.index);
      if (retryIndexes.length === 0) {
        continue;
      }
      const loaded = loadRecipeById(node.recipeId ?? task.recipeId);
      if (!loaded.ok) {
        continue;
      }
      const version = (node.versions ?? []).find((item) => item.id === node.currentVersionId);
      const slots = captureSlots(node, opened.project.nodes, opened.project.edges);
      const variantCount = version?.variantCountRequested ?? node.variantCount ?? Math.max(1, task.variants.length);
      const seeds = Array.from({ length: variantCount }, (_, index) => {
        const fromTask = task.variants.find((item) => item.index === index)?.seedUsed;
        if (fromTask != null) {
          return fromTask >>> 0;
        }
        const fromVersion = version?.variants.find((item) => item.index === index)?.seedUsed;
        if (fromVersion != null) {
          return fromVersion >>> 0;
        }
        return allocateSeeds(node.params ?? {}, variantCount)[index] ?? 0;
      });
      queued.push({
        promptText: slots.find((slot) => slot.role === "prompt")?.text ?? "",
        fingerprint: fp,
        params: { ...(node.params ?? {}) },
        recipe: loaded.recipe,
        phaseBefore: node.phase ?? "idle",
        variantCount,
        nodeId: node.id,
        slots,
        seeds,
        usesStaleUpstream: false,
        dependsOnNodeIds: [],
        runId: "",
        retryVersionId: version?.id ?? "",
        retryIndexes,
      });
    }
    if (queued.length === 0) {
      return snapshot;
    }
    const needsLocal = queued.some((item) => item.recipe.lane !== "cloud");
    if (needsLocal) {
      if (comfyBaseUrl === null || comfyBaseUrl.length === 0) {
        throw new ExecutionHttpError(400, USER_FACING.comfyUnconfigured);
      }
      const probe = await probeComfy();
      if (!probe.reachable) {
        throw new ExecutionHttpError(400, probe.message);
      }
    }
    const newRunId = randomUUID();
    const iso = now().toISOString();
    const tasks = queued.map((item) => {
      const taskId = randomUUID();
      const versionId = item.retryVersionId.length > 0 ? item.retryVersionId : null;
      snapshots.set(taskId, { ...item, runId: newRunId, retryVersionId: versionId });
      return {
        taskId,
        nodeId: item.nodeId,
        lane: item.recipe.lane,
        recipeId: item.recipe.id,
        recipeVersion: item.recipe.version,
        fingerprintAtStart: item.fingerprint,
        variants: item.seeds.map((_, index) => ({
          index,
          state: item.retryIndexes.includes(index) ? "queued" : "succeeded",
          seedUsed: item.seeds[index] ?? null,
          outputs: [] as import("@canvas/schema").MediaRef[],
          error: null,
          providerJobId: null,
        })),
      };
    });
    const plan: RunPlan = {
      nodes: queued.map((item) => ({
        nodeId: item.nodeId,
        action: "run" as const,
        message: USER_FACING.handingToLocalQueue,
      })),
      summary: USER_FACING.handingToLocalQueue,
    };
    const inserted = store.insertQueued({
      runId: newRunId,
      projectId: snapshot.projectId,
      clientRequestId: `resume-${runId}-${iso}`,
      scope: snapshot.scope,
      force: false,
      plan,
      summary: USER_FACING.handingToLocalQueue,
      tasks,
      now: iso,
    });
    for (const event of store.listEvents(newRunId)) {
      publish(event);
    }
    for (const task of inserted.tasks) {
      emitNodePatch(newRunId, task.nodeId, {
        phase: "queued",
        lastRunId: newRunId,
        lastTaskId: task.taskId,
        lastAttemptFingerprint: task.fingerprintAtStart,
        runner: task.lane === "cloud" ? "cloud" : "local",
        progress: { ratio: null, label: task.lane === "cloud" ? USER_FACING.generatingLabel : queueLabel(task.taskId) },
        lastError: null,
      }, false);
    }
    schedulePump();
    scheduleCloudPump();
    return store.getRun(newRunId) ?? inserted;
  }

  function fireCancel(taskId: string): void {
    const list = cancelResolvers.get(taskId) ?? [];
    cancelResolvers.delete(taskId);
    for (const resolve of list) {
      resolve();
    }
  }

  function armCancel(taskId: string): Promise<void> {
    if (cancelling.has(taskId)) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      const list = cancelResolvers.get(taskId) ?? [];
      list.push(resolve);
      cancelResolvers.set(taskId, list);
    });
  }

  function adapterFor(id: string): CloudVideoAdapter | undefined {
    return cloudAdapters.find((item) => item.id === id);
  }

  async function runDerive(projectRoot: string, media: MediaRef, bytes: Uint8Array): Promise<{ ok: true; media: MediaRef } | { ok: false }> {
    if (options.deriveVideo !== undefined) {
      return options.deriveVideo({ projectRoot, media, bytes });
    }
    const stored = readAppJsonSync(options.dataDir);
    return deriveVideoWithFfmpeg({
      projectRoot,
      media,
      timeoutMs: stored.ffmpegMaxRunMs ?? FFMPEG_MAX_RUN_MS,
      ffmpegPath: stored.ffmpegPath,
      ffprobePath: stored.ffprobePath,
    });
  }

  function sleep(ms: number): Promise<void> {
    if (ms <= 0) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      setTimeout(resolve, ms);
    });
  }

  async function collectCloudFiles(snap: TaskSnapshot): Promise<Array<{ role: TaskSnapshot["slots"][number]["role"]; order: number; mime: string; bytes: Uint8Array }>> {
    const files = [];
    for (const slot of snap.slots) {
      if (slot.relativePath === null) {
        continue;
      }
      if (slot.role !== "first_frame" && slot.role !== "last_frame") {
        continue;
      }
      const bytes = await readSnapMedia(slot.relativePath);
      files.push({ role: slot.role, order: slot.order, mime: "image/png", bytes });
    }
    return files;
  }

  async function landPartialVideo(task: TaskRecord, media: MediaRef): Promise<void> {
    if (disposed || !taskStillOpen(task.taskId)) {
      return;
    }
    const error = userError("PROXY_MEDIA_FAILED", USER_FACING.videoFileWithoutPreview);
    const providerJobId = promptIds.get(task.taskId) ?? null;
    persist(
      [{ type: "task.finished", runId: task.runId, taskId: task.taskId, state: "partial", error }],
      [{
        taskId: task.taskId,
        state: "partial",
        error,
        variants: [{
          index: 0,
          state: "partial",
          seedUsed: null,
          outputs: [media],
          error,
          providerJobId,
        }],
      }],
    );
    publish({ type: "task.finished", runId: task.runId, taskId: task.taskId, state: "partial", error });
    const live = session.current?.project.nodes[task.nodeId];
    const settled = live !== undefined && hasSucceededVariant(live);
    if (!settled) {
      emitNodePatch(task.runId, task.nodeId, {
        phase: "idle",
        output: media,
        outputRevision: (live?.outputRevision ?? 1) + 1,
        lastError: error,
        progress: null,
        runner: "cloud",
        lastRunId: task.runId,
        lastTaskId: task.taskId,
      }, true);
    } else {
      emitNodePatch(task.runId, task.nodeId, {
        phase: "succeeded",
        lastError: error,
        progress: null,
        runner: "cloud",
        lastRunId: task.runId,
        lastTaskId: task.taskId,
      }, false);
    }
    await finishRun(task.runId, task.taskId, "partial", error);
  }

  async function landSucceededVideo(task: TaskRecord, snap: TaskSnapshot, media: MediaRef, tooLate: boolean): Promise<void> {
    if (disposed || !taskStillOpen(task.taskId)) {
      return;
    }
    const iso = now().toISOString();
    const variant: Variant = {
      id: randomUUID(),
      index: 0,
      phase: "succeeded",
      seedUsed: snap.seeds[0] ?? null,
      output: media,
      text: null,
      error: null,
      createdAt: iso,
    };
    const variants = [variant];
    await writeVariantProgress(task, snap, variants, variant, tooLate, true);
    const taskState: TaskState = tooLate ? "partial" : "succeeded";
    persist(
      [{ type: "task.finished", runId: task.runId, taskId: task.taskId, state: taskState, error: null }],
      [{ taskId: task.taskId, state: taskState, error: null }],
    );
    publish({ type: "task.finished", runId: task.runId, taskId: task.taskId, state: taskState, error: null });
    emitNodePatch(task.runId, task.nodeId, {
      phase: "succeeded",
      progress: null,
      runner: "cloud",
    }, false);
    await finishRun(task.runId, task.taskId, taskState, null);
  }

  async function landCloudBytes(task: TaskRecord, snap: TaskSnapshot, bytes: Uint8Array, tooLate: boolean): Promise<void> {
    const opened = session.current;
    if (opened === null) {
      await failTask(task, userError("INGEST_FAILED", USER_FACING.ingestFailed));
      return;
    }
    const ingested = await ingestBytes({
      projectRoot: opened.absolutePath,
      bytes,
      originalFileName: `${task.taskId}.mp4`,
      source: "generation",
      taskId: task.taskId,
      now,
      makeThumb: false,
    });
    if (!ingested.ok || ingested.media.kind !== "video") {
      await failTask(task, userError("INGEST_FAILED", ingested.ok ? USER_FACING.ingestFailed : ingested.message));
      return;
    }
    const derived = await runDerive(opened.absolutePath, ingested.media, bytes);
    const media = derived.ok ? derived.media : ingested.media;
    if (derived.ok && videoDerivativesReady(media)) {
      await landSucceededVideo(task, snap, media, tooLate);
      return;
    }
    await landPartialVideo(task, ingested.media);
  }

  async function finishCloudCancel(
    task: TaskRecord,
    snap: TaskSnapshot,
    adapter: CloudVideoAdapter,
    providerJobId: string,
    secret: { providerId: string },
  ): Promise<void> {
    if (!taskStillOpen(task.taskId)) {
      return;
    }
    let decision: "cancelled" | "unsupported" | "already-finished" | "timeout";
    try {
      decision = await Promise.race([
        adapter.cancel(providerJobId, secret),
        timeoutFor(task.taskId).then(() => "timeout" as const),
      ]);
    } catch {
      await finishCloudUnclear(task, snap);
      return;
    }
    if (decision === "timeout" || decision === "unsupported") {
      await finishCloudUnclear(task, snap);
      return;
    }
    if (decision === "cancelled") {
      await finishCancelled(task, snap);
      return;
    }
    cancelMessages.set(task.taskId, USER_FACING.tooLateToCancel);
    try {
      const downloaded = await adapter.download(providerJobId, secret);
      await landCloudBytes(task, snap, downloaded.bytes, true);
    } catch {
      await finishCloudUnclear(task, snap);
    }
  }

  async function submitCloudAndWait(task: TaskRecord): Promise<void> {
    if (disposed) {
      return;
    }
    if (restoredCloud.has(task.taskId)) {
      return;
    }
    const snap = snapshots.get(task.taskId);
    if (snap === undefined) {
      await failTask(task, userError("RESTART_UNCERTAIN", USER_FACING.restartUncertain));
      return;
    }
    if (cancelling.has(task.taskId)) {
      await finishCancelled(task, snap);
      return;
    }
    const adapter = adapterFor(snap.recipe.adapterId);
    if (adapter === undefined) {
      await failTask(task, userError("GENERATION_INCOMPLETE", USER_FACING.generationIncomplete));
      return;
    }
    let heldSecret: Uint8Array | null = null;
    if (snap.recipe.requiresSecret) {
      const providerId = snap.recipe.providerId ?? "";
      const openedNode = session.current?.project.nodes[task.nodeId];
      const account = openedNode?.secretRef?.account && openedNode.secretRef.account.length > 0
        ? openedNode.secretRef.account
        : "default";
      if (options.secretPresent !== undefined) {
        if (!options.secretPresent({ providerId, account })) {
          await failTask(task, userError("SECRET_MISSING", USER_FACING.secretMissing));
          return;
        }
      } else {
        const bytes = secretStore.getSync({ providerId, account });
        if (bytes === null) {
          await failTask(task, userError("SECRET_MISSING", USER_FACING.secretMissing));
          return;
        }
        heldSecret = bytes;
        if (new TextDecoder().decode(bytes) === "test-key-not-real") {
          const message = redactSecret(USER_FACING.secretRejected, bytes);
          heldSecret = null;
          await failTask(task, userError("SECRET_REJECTED", message));
          return;
        }
      }
    }
    emitNodePatch(task.runId, task.nodeId, {
      phase: "running",
      runner: "cloud",
      progress: { ratio: null, label: USER_FACING.generatingLabel },
    }, false);
    const secret = { providerId: snap.recipe.providerId ?? "" };
    const submitSecret = { providerId: secret.providerId, bytes: heldSecret ?? undefined };
    let submitted: { providerJobId: string };
    try {
      const files = await collectCloudFiles(snap);
      submitted = await adapter.submit({
        taskId: task.taskId,
        slots: snap.slots.map((slot) => ({
          role: slot.role,
          order: slot.order,
          fromNodeId: slot.fromNodeId ?? "",
          text: slot.text ?? undefined,
          contentHash: slot.contentHash ?? undefined,
        })),
        params: snap.params,
        files,
      }, submitSecret);
      submitSecret.bytes = undefined;
    } catch {
      const message = redactSecret(USER_FACING.generationIncomplete, heldSecret);
      heldSecret = null;
      await failTask(task, userError("GENERATION_INCOMPLETE", message));
      return;
    }
    if (disposed || !taskStillOpen(task.taskId)) {
      return;
    }
    promptIds.set(task.taskId, submitted.providerJobId);
    const abort = new AbortController();
    aborts.set(task.taskId, abort);
    persist(
      [{ type: "task.submitted", runId: task.runId, taskId: task.taskId, providerJobId: submitted.providerJobId }],
      [{ taskId: task.taskId, state: "submitted" }],
    );
    persist(
      [{ type: "task.running", runId: task.runId, taskId: task.taskId }],
      [{ taskId: task.taskId, state: "running" }],
    );
    publish({ type: "task.submitted", runId: task.runId, taskId: task.taskId, providerJobId: submitted.providerJobId });
    publish({ type: "task.running", runId: task.runId, taskId: task.taskId });
    const interval = options.cloudPollIntervalMs ?? snap.recipe.cloud?.constraints.pollIntervalMs ?? 0;
    let lastResponseMs = now().getTime();
    let heartbeatSeconds = -1;
    let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
    const stopHeartbeat = (): void => {
      if (heartbeatTimer !== null) {
        clearInterval(heartbeatTimer);
        heartbeatTimers.delete(heartbeatTimer);
        heartbeatTimer = null;
      }
    };
    const notePollResponse = (): void => {
      lastResponseMs = now().getTime();
      heartbeatSeconds = -1;
      const live = session.current?.project.nodes[task.nodeId];
      const ratio = live?.progress?.ratio ?? null;
      emitNodePatch(task.runId, task.nodeId, {
        progress: { ratio, label: USER_FACING.generatingLabel },
      }, false);
    };
    heartbeatTimer = setInterval(() => {
      if (disposed || !taskStillOpen(task.taskId)) {
        stopHeartbeat();
        return;
      }
      const elapsed = now().getTime() - lastResponseMs;
      if (elapsed <= cloudHeartbeatStaleMs) {
        return;
      }
      const seconds = Math.max(0, Math.floor(elapsed / 1000));
      if (seconds === heartbeatSeconds) {
        return;
      }
      heartbeatSeconds = seconds;
      const live = session.current?.project.nodes[task.nodeId];
      const ratio = live?.progress?.ratio ?? null;
      emitNodePatch(task.runId, task.nodeId, {
        progress: { ratio, label: USER_FACING.cloudHeartbeat(seconds) },
      }, false);
    }, cloudHeartbeatTickMs);
    heartbeatTimers.add(heartbeatTimer);
    try {
    while (!disposed && taskStillOpen(task.taskId)) {
      if (cancelling.has(task.taskId)) {
        await finishCloudCancel(task, snap, adapter, submitted.providerJobId, secret);
        return;
      }
      const raced = await Promise.race([
        adapter.poll(submitted.providerJobId, secret).then((result) => ({ kind: "poll" as const, result })),
        armCancel(task.taskId).then(() => ({ kind: "cancel" as const })),
        timeoutFor(task.taskId).then(() => ({ kind: "timeout" as const })),
      ]);
      if (disposed || !taskStillOpen(task.taskId)) {
        return;
      }
      if (raced.kind === "timeout") {
        await finishCloudUnclear(task, snap);
        return;
      }
      if (raced.kind === "cancel") {
        await finishCloudCancel(task, snap, adapter, submitted.providerJobId, secret);
        return;
      }
      if (raced.result.state === "failed") {
        const message = redactSecret(raced.result.message, heldSecret);
        heldSecret = null;
        await failTask(task, userError(
          "GENERATION_INCOMPLETE",
          message.length > 0 ? message : USER_FACING.generationFailedNoDetail,
        ));
        return;
      }
      if (raced.result.state === "succeeded") {
        const tooLate = cancelling.has(task.taskId);
        if (tooLate) {
          await finishCloudCancel(task, snap, adapter, submitted.providerJobId, secret);
          return;
        }
        const downloaded = await adapter.download(submitted.providerJobId, secret);
        await landCloudBytes(task, snap, downloaded.bytes, false);
        return;
      }
      if (raced.result.state === "queued" || raced.result.state === "running") {
        notePollResponse();
      }
      const waited = await Promise.race([
        sleep(interval).then(() => "tick" as const),
        armCancel(task.taskId).then(() => "cancel" as const),
        timeoutFor(task.taskId).then(() => "timeout" as const),
      ]);
      if (waited === "timeout") {
        await finishCloudUnclear(task, snap);
        return;
      }
      if (waited === "cancel") {
        await finishCloudCancel(task, snap, adapter, submitted.providerJobId, secret);
        return;
      }
    }
    } finally {
      stopHeartbeat();
    }
  }

  function snapForRestored(task: TaskRecord): TaskSnapshot | null {
    const opened = session.current;
    if (opened === null) {
      return null;
    }
    const node = opened.project.nodes[task.nodeId];
    if (node === undefined || node.kind !== "generation") {
      return null;
    }
    const loaded = loadRecipeById(task.recipeId);
    if (!loaded.ok) {
      return null;
    }
    const slots = captureSlots(node, opened.project.nodes, opened.project.edges);
    const seeds = task.variants.length > 0
      ? task.variants.map((item) => (item.seedUsed ?? 0) >>> 0)
      : [0];
    return {
      runId: task.runId,
      promptText: slots.find((slot) => slot.role === "prompt")?.text ?? "",
      fingerprint: task.fingerprintAtStart,
      params: { ...(node.params ?? {}) },
      recipe: loaded.recipe,
      phaseBefore: generationRestingPhase(node),
      variantCount: node.variantCount ?? Math.max(1, seeds.length),
      nodeId: node.id,
      slots,
      seeds,
      usesStaleUpstream: false,
      dependsOnNodeIds: [],
    };
  }

  async function drainRecover(taskId: string): Promise<void> {
    const pending = pendingRecover.get(taskId);
    if (pending === undefined) {
      return;
    }
    const snap = snapForRestored(pending.task);
    if (snap === null) {
      return;
    }
    pendingRecover.delete(taskId);
    if (!taskStillOpen(taskId) && pending.task.state !== "running" && pending.task.state !== "submitted" && pending.task.state !== "queued") {
      return;
    }
    if (pending.kind === "cloud-bytes") {
      await landCloudBytes(pending.task, snap, pending.bytes, false);
      return;
    }
    const landed = await ingestVariantImage(pending.task, pending.images);
    if (!landed.ok) {
      await failTask(pending.task, landed.error);
      return;
    }
    const iso = now().toISOString();
    const variant: Variant = {
      id: randomUUID(),
      index: 0,
      phase: "succeeded",
      seedUsed: snap.seeds[0] ?? null,
      output: landed.media,
      text: null,
      error: null,
      createdAt: iso,
    };
    await writeVariantProgress(pending.task, snap, [variant], variant, false, true);
    if (!taskStillOpen(taskId)) {
      return;
    }
    persist(
      [{ type: "task.finished", runId: pending.task.runId, taskId, state: "succeeded", error: null }],
      [{ taskId, state: "succeeded", error: null }],
    );
    publish({ type: "task.finished", runId: pending.task.runId, taskId, state: "succeeded", error: null });
    emitNodePatch(pending.task.runId, pending.task.nodeId, {
      phase: "succeeded",
      progress: null,
    }, false);
    await finishRun(pending.task.runId, taskId, "succeeded", null);
  }

  async function attachedLocal(task: TaskRecord, promptId: string): Promise<void> {
    if (executor === undefined) {
      markRestartUncertain(task);
      refreshRunAfterInterrupt(task.runId);
      return;
    }
    const abort = new AbortController();
    aborts.set(task.taskId, abort);
    let result: ComfyWaitResult | "timeout";
    try {
      result = await Promise.race([
        executor.wait(promptId, abort.signal),
        timeoutFor(task.taskId),
      ]);
    } catch {
      if (taskStillOpen(task.taskId)) {
        markRestartUncertain(task);
        refreshRunAfterInterrupt(task.runId);
      }
      return;
    }
    if (disposed || !taskStillOpen(task.taskId)) {
      return;
    }
    const snap = snapForRestored(task);
    if (result === "timeout") {
      if (snap !== null) {
        await finishUncertain(task, snap);
      } else {
        markRestartUncertain(task);
        refreshRunAfterInterrupt(task.runId);
      }
      return;
    }
    if (result.ok) {
      pendingRecover.set(task.taskId, { kind: "local-images", task, images: result.images });
      if (session.current !== null) {
        await drainRecover(task.taskId);
      }
      return;
    }
    if (result.code === "cancelled" || cancelling.has(task.taskId)) {
      if (snap !== null) {
        await finishCancelled(task, snap);
      }
      return;
    }
    if (snap !== null) {
      await failTask(task, userError("GENERATION_INCOMPLETE", result.message.length > 0 ? result.message : USER_FACING.generationIncomplete));
    }
  }

  async function attachedCloud(task: TaskRecord, jobId: string): Promise<void> {
    const loaded = loadRecipeById(task.recipeId);
    const adapter = loaded.ok ? adapterFor(loaded.recipe.adapterId) : undefined;
    if (!loaded.ok || adapter === undefined) {
      markRestartUncertain(task);
      refreshRunAfterInterrupt(task.runId);
      return;
    }
    const secret = { providerId: loaded.recipe.providerId ?? "" };
    const interval = options.cloudPollIntervalMs ?? loaded.recipe.cloud?.constraints.pollIntervalMs ?? 0;
    while (!disposed && taskStillOpen(task.taskId)) {
      let result;
      try {
        result = await adapter.poll(jobId, secret);
      } catch {
        if (taskStillOpen(task.taskId)) {
          markRestartUncertain(task);
          refreshRunAfterInterrupt(task.runId);
        }
        return;
      }
      if (disposed || !taskStillOpen(task.taskId)) {
        return;
      }
      if (result.state === "failed") {
        const snap = snapForRestored(task);
        if (snap !== null) {
          await failTask(task, userError(
            "GENERATION_INCOMPLETE",
            result.message.length > 0 ? result.message : USER_FACING.generationFailedNoDetail,
          ));
        }
        return;
      }
      if (result.state === "succeeded") {
        try {
          const downloaded = await adapter.download(jobId, secret);
          pendingRecover.set(task.taskId, {
            kind: "cloud-bytes",
            task,
            bytes: downloaded.bytes,
            mime: downloaded.mime,
          });
          if (session.current !== null) {
            await drainRecover(task.taskId);
          }
        } catch {
          if (taskStillOpen(task.taskId)) {
            markRestartUncertain(task);
            refreshRunAfterInterrupt(task.runId);
          }
        }
        return;
      }
      const waited = await Promise.race([
        sleep(interval).then(() => "tick" as const),
        armCancel(task.taskId).then(() => "cancel" as const),
      ]);
      if (waited === "cancel") {
        const snap = snapForRestored(task);
        if (snap !== null) {
          await finishCloudCancel(task, snap, adapter, jobId, secret);
        }
        return;
      }
    }
  }

  function scheduleCloudPump(): void {
    cloudPumpAgain = true;
    if (cloudPumping) {
      return;
    }
    cloudPumping = true;
    setImmediate(() => {
      void (async () => {
        try {
          while (!disposed) {
            cloudPumpAgain = false;
            if (cloudRunning.size >= cloudLimit) {
              break;
            }
            let next: TaskRecord | undefined;
            try {
              const queued = store.listTasks({ lane: "cloud", states: ["queued"] }).filter(
                (task) => !cancelling.has(task.taskId) && !cloudRunning.has(task.taskId) && !restoredCloud.has(task.taskId),
              );
              for (const task of queued) {
                const snap = snapshots.get(task.taskId);
                const run = store.getRun(task.runId);
                if (snap !== undefined && run !== null) {
                  const blocked = dependsOnBlocked(snap, run);
                  if (blocked === "skip") {
                    await finishSkippedUpstream(task, snap);
                    continue;
                  }
                  if (blocked === "wait") {
                    continue;
                  }
                }
                next = task;
                break;
              }
            } catch (err) {
              if (err instanceof TaskStoreError && err.code === "CLOSED") {
                break;
              }
              throw err;
            }
            if (next === undefined) {
              if (cloudPumpAgain) {
                continue;
              }
              break;
            }
            const started = next;
            cloudRunning.add(started.taskId);
            void submitCloudAndWait(started).finally(() => {
              cloudRunning.delete(started.taskId);
              if (!disposed) {
                scheduleCloudPump();
                schedulePump();
              }
            });
            if (cloudRunning.size >= cloudLimit) {
              break;
            }
          }
        } finally {
          cloudPumping = false;
          if (cloudPumpAgain && !disposed) {
            scheduleCloudPump();
          }
        }
      })();
    });
  }

  function latestPartialVideo(nodeId: string): MediaRef | null {
    const tasks = store.listTasks({ lane: "cloud", states: ["partial"] }).filter((task) => task.nodeId === nodeId);
    for (let i = tasks.length - 1; i >= 0; i -= 1) {
      const task = tasks[i];
      if (task === undefined) {
        continue;
      }
      for (const variant of task.variants) {
        const media = variant.outputs.find((item) => item.kind === "video" && !videoDerivativesReady(item));
        if (media !== undefined) {
          return media;
        }
      }
    }
    return null;
  }

  async function applyDerivedOntoNode(nodeId: string, media: MediaRef): Promise<void> {
    const opened = session.current;
    if (opened === null) {
      return;
    }
    const live = opened.project.nodes[nodeId];
    if (live === undefined || live.kind !== "generation") {
      return;
    }
    const iso = now().toISOString();
    const recipeId = live.recipeId ?? "";
    const loaded = loadRecipeById(recipeId);
    const variant: Variant = {
      id: randomUUID(),
      index: 0,
      phase: "succeeded",
      seedUsed: null,
      output: media,
      text: null,
      error: null,
      createdAt: iso,
    };
    const versions = [...(live.versions ?? [])];
    const version: ResultVersion = {
      id: randomUUID(),
      createdAt: iso,
      fingerprint: live.lastAttemptFingerprint ?? live.lastSuccessFingerprint ?? "",
      recipeId,
      recipeVersion: live.recipeVersion ?? 1,
      paramSnapshot: { ...(live.params ?? {}) },
      variantCountRequested: live.variantCount ?? 1,
      variants: [variant],
    };
    versions.push(version);
    const fingerprint = fingerprintNode(live, opened.project.nodes, opened.project.edges);
    emitNodePatch(live.lastRunId ?? null, nodeId, {
      phase: "succeeded",
      freshness: "fresh",
      versions,
      currentVersionId: version.id,
      activeVariantId: variant.id,
      output: media,
      outputRevision: (live.outputRevision ?? 1) + 1,
      lastSuccessFingerprint: fingerprint,
      lastError: null,
      progress: null,
      runner: loaded.ok && loaded.recipe.lane === "cloud" ? "cloud" : live.runner ?? "cloud",
    }, true);
    applyStaleFrom(opened.project.nodes, opened.project.edges, nodeId);
    await session.flushAutosave();
  }

  async function regeneratePreview(nodeId: string): Promise<{ ok: true } | { ok: false; message: string }> {
    const opened = requireProject();
    const node = opened.project.nodes[nodeId];
    if (node === undefined || node.kind !== "generation") {
      throw new ExecutionHttpError(404, USER_FACING.recipeNotFound);
    }
    const fromTask = latestPartialVideo(nodeId);
    const media = fromTask
      ?? (node.output != null && node.output.kind === "video" && !videoDerivativesReady(node.output) ? node.output : null);
    if (media === null || media.contentHash === null) {
      return { ok: false, message: USER_FACING.videoFileWithoutPreview };
    }
    const bytes = await readSnapMedia(media.relativePath);
    const derived = await runDerive(opened.absolutePath, media, bytes);
    if (!derived.ok || !videoDerivativesReady(derived.media)) {
      return { ok: false, message: USER_FACING.videoFileWithoutPreview };
    }
    await applyDerivedOntoNode(nodeId, derived.media);
    return { ok: true };
  }

  const service: ExecutionRuntime = {
    async listCapabilities(): Promise<CapabilityDescriptor[]> {
      return listCapabilities();
    },
    async listRecipes(): Promise<RecipeSummary[]> {
      return listRecipes();
    },
    async planRun(request: RunRequest): Promise<RunPlan> {
      const planned = buildPlan(request);
      if (!planned.ok) {
        throw new ExecutionHttpError(400, planned.message);
      }
      return planned.plan;
    },
    startRun,
    async getRun(runId: string): Promise<RunSnapshot | null> {
      return store.getRun(runId);
    },
    cancelRun,
    cancelTask,
    retryFailed,
    regeneratePreview,
    async resumeInterrupted(runId: string): Promise<RunSnapshot> {
      return resumeWork(runId);
    },
    subscribe(runId: string): AsyncIterable<RunEvent> {
      return hub.iterate(runId);
    },
    watchRun(runId: string, signal: AbortSignal): AsyncIterable<RunEvent> {
      return hub.iterate(runId, signal);
    },
    dispose(): void {
      disposed = true;
      for (const timer of heartbeatTimers) {
        clearInterval(timer);
      }
      heartbeatTimers.clear();
      for (const abort of aborts.values()) {
        abort.abort();
      }
      hub.dispose();
    },
    comfyHealth,
    getComfyBaseUrl: () => comfyBaseUrl,
    setComfyBaseUrl,
    probeComfy,
    recheckComfy: probeComfy,
    setUseLocalComfy,
    getUseLocalComfy: () => useLocalComfy,
    usingRealComfy: () => executor instanceof ComfyHttpExecutor,
    lastCancelMessage: (taskId: string) => cancelMessages.get(taskId) ?? null,
    reconcileOpenProject,
  };
  interruptOrphanedTasks();
  return service;
}
