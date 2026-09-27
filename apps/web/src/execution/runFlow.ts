/**
 * 运行此节点：确认框先于乐观；成功才 flush + POST 已有 RunRequest。
 * 乐观不写 phase=queued。
 */
import type { RunRequest, RunSnapshot } from "@canvas/schema";
import { USER_FACING } from "@canvas/schema";
import type { ApiResult } from "../api/client.ts";
import type { RunEmitResult } from "../canvas/EditorStore.ts";

export type OptimisticRun = {
  nodeId: string;
  clientRequestId: string;
  label: string;
  cancelling: boolean;
  pendingCancel: boolean;
  taskId: string | null;
  runId: string | null;
};

export function optimisticFromEmit(request: RunRequest, nodeId: string): OptimisticRun {
  return {
    nodeId,
    clientRequestId: request.clientRequestId,
    label: USER_FACING.handingToLocalQueue,
    cancelling: false,
    pendingCancel: false,
    taskId: null,
    runId: null,
  };
}

export function optimisticAfterCancel(prev: OptimisticRun, taskId: string | null): OptimisticRun {
  const id = taskId != null && taskId.length > 0 ? taskId : prev.taskId;
  return {
    ...prev,
    cancelling: true,
    pendingCancel: id == null || id.length === 0,
    label: USER_FACING.cancelling,
    taskId: id,
  };
}

export function attachTaskIds(optimistic: OptimisticRun, snapshot: RunSnapshot): OptimisticRun {
  const task =
    snapshot.tasks.find((item) => item.nodeId === optimistic.nodeId) ?? snapshot.tasks[0];
  return {
    ...optimistic,
    runId: snapshot.runId,
    taskId: task?.taskId ?? optimistic.taskId,
  };
}

export function isThisNodeBusy(input: {
  nodeId: string | undefined;
  phase: string | undefined;
  optimisticThis: { nodeId: string; cancelling: boolean } | null;
}): boolean {
  if (input.nodeId === undefined) {
    return false;
  }
  if (input.optimisticThis?.nodeId === input.nodeId) {
    return true;
  }
  return input.phase === "queued" || input.phase === "running";
}

/** 服务器已经接上排队/运行，或这次已经落到终态时，丢掉「正在交给本机队列」。 */
export function optimisticClearedByPatch(phase: string | undefined): boolean {
  return phase === "queued" || phase === "running" || phase === "succeeded" || phase === "idle" || phase === "failed";
}

export async function submitEmittedRun(options: {
  emit: RunEmitResult;
  nodeId: string | null;
  flushWorkingCopy: () => Promise<boolean>;
  postRun: (request: RunRequest) => Promise<ApiResult<RunSnapshot>>;
  setOptimistic: (value: OptimisticRun | null) => void;
}): Promise<{
  posted: boolean;
  needsConfirm: boolean;
  message: string | null;
  snapshot: RunSnapshot | null;
  request: RunRequest | null;
}> {
  if (!options.emit.ok) {
    if (options.emit.needsConfirm === true) {
      return {
        posted: false,
        needsConfirm: true,
        message: options.emit.confirmMessage ?? USER_FACING.runFreshConfirm,
        snapshot: null,
        request: null,
      };
    }
    return {
      posted: false,
      needsConfirm: false,
      message: options.emit.message,
      snapshot: null,
      request: null,
    };
  }
  const request = options.emit.request;
  if (options.nodeId !== null) {
    options.setOptimistic(optimisticFromEmit(request, options.nodeId));
  }
  const flushed = await options.flushWorkingCopy();
  if (!flushed) {
    options.setOptimistic(null);
    return {
      posted: false,
      needsConfirm: false,
      message: USER_FACING.workingCopySyncFailed,
      snapshot: null,
      request,
    };
  }
  const posted = await options.postRun(request);
  if (!posted.ok) {
    options.setOptimistic(null);
    return {
      posted: false,
      needsConfirm: false,
      message: posted.message,
      snapshot: null,
      request,
    };
  }
  return {
    posted: true,
    needsConfirm: false,
    message: null,
    snapshot: posted.data,
    request,
  };
}
