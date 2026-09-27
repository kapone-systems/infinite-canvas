/**
 * 方案第 9.9 节工作副本合并。
 * 客户端 PUT 不得整表覆盖执行字段；queued/running 时变体指针仍以服务器为准。
 */

import { fingerprintNode } from "./fingerprint.ts";
import type {
  CanvasProjectFile,
  ProjectNode,
  SchemaIssue,
  WorkingCopyPutBody,
} from "./types.ts";
import {
  CLIENT_AUTHORITATIVE_NODE_FIELDS,
  SERVER_AUTHORITATIVE_NODE_FIELDS,
  VARIANT_POINTER_FIELDS,
} from "./types.ts";
import { USER_FACING } from "./userFacingMessages.ts";
import {
  isIssue,
  parseEdgeMap,
  parseGroupMap,
  parseNodeMap,
  policyIssue,
} from "./validateProject.ts";

export type MergeWorkingCopyResult =
  | {
      ok: true;
      project: CanvasProjectFile;
      executionRevisions: Record<string, number>;
    }
  | SchemaIssue;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function invariant(): SchemaIssue {
  return {
    ok: false,
    httpStatus: 400,
    code: "working_copy_invariant",
    message: USER_FACING.workingCopySyncFailed,
  };
}

function copyField(
  target: ProjectNode,
  source: ProjectNode,
  key: keyof ProjectNode,
): void {
  if (!Object.hasOwn(source, key)) {
    return;
  }
  const value = source[key];
  if (value === undefined) {
    return;
  }
  (target as unknown as Record<string, unknown>)[key] = structuredClone(value);
}

function serverExecutionDefaults(): Pick<
  ProjectNode,
  (typeof SERVER_AUTHORITATIVE_NODE_FIELDS)[number]
> {
  return {
    phase: "idle",
    progress: null,
    versions: [],
    lastSuccessFingerprint: null,
    lastAttemptFingerprint: null,
    lastError: null,
    runner: null,
    lastRunId: null,
    lastTaskId: null,
    inputsChangedWhileRunning: false,
    executionRevision: 0,
  };
}

function isQueuedOrRunning(phase: ProjectNode["phase"]): boolean {
  return phase === "queued" || phase === "running";
}

/**
 * 仅 generation + queued|running：用合并后整图（含上游 text）比指纹。
 * 只比 promptDraft 会漏连线改字。inputsChangedWhileRunning 仍是服务器权威。
 */
function markInputsChangedWhileRunning(project: CanvasProjectFile): void {
  for (const node of Object.values(project.nodes)) {
    if (node.kind !== "generation" || !isQueuedOrRunning(node.phase)) {
      continue;
    }
    const current = fingerprintNode(node, project.nodes, project.edges);
    if (current !== (node.lastAttemptFingerprint ?? null)) {
      node.inputsChangedWhileRunning = true;
    }
  }
}

function mergeExistingNode(server: ProjectNode, client: ProjectNode): ProjectNode {
  const merged = structuredClone(server);
  for (const key of CLIENT_AUTHORITATIVE_NODE_FIELDS) {
    copyField(merged, client, key);
  }
  if (!isQueuedOrRunning(merged.phase)) {
    for (const key of VARIANT_POINTER_FIELDS) {
      copyField(merged, client, key);
    }
  }
  if (typeof client.updatedAt === "string") {
    merged.updatedAt = client.updatedAt;
  }
  for (const key of SERVER_AUTHORITATIVE_NODE_FIELDS) {
    copyField(merged, server, key);
  }
  return merged;
}

function adoptNewNode(client: ProjectNode): ProjectNode {
  const adopted = structuredClone(client);
  const defaults = serverExecutionDefaults();
  for (const key of SERVER_AUTHORITATIVE_NODE_FIELDS) {
    (adopted as unknown as Record<string, unknown>)[key] = structuredClone(defaults[key]);
  }
  return adopted;
}

function parseWorkingCopyPut(input: unknown): WorkingCopyPutBody | SchemaIssue {
  if (!isRecord(input)) {
    return invariant();
  }
  if (!Number.isInteger(input.contentRevision) || (input.contentRevision as number) < 0) {
    return invariant();
  }
  const policy = policyIssue(input);
  if (policy !== null) {
    return policy;
  }
  const nodes = parseNodeMap(input.nodes);
  if (isIssue(nodes)) {
    return nodes;
  }
  const edges = parseEdgeMap(input.edges);
  if (isIssue(edges)) {
    return edges;
  }
  const groups = parseGroupMap(input.groups);
  if (isIssue(groups)) {
    return groups;
  }
  return {
    contentRevision: input.contentRevision as number,
    nodes,
    edges,
    groups,
  };
}

function executionRevisionsOf(
  nodes: Record<string, ProjectNode>,
): Record<string, number> {
  const revisions: Record<string, number> = {};
  for (const [id, node] of Object.entries(nodes)) {
    revisions[id] = node.executionRevision ?? 0;
  }
  return revisions;
}

export function mergeWorkingCopy(
  server: CanvasProjectFile,
  client: unknown,
  options?: { now?: Date },
): MergeWorkingCopyResult {
  const parsed = parseWorkingCopyPut(client);
  if (isIssue(parsed)) {
    return parsed;
  }
  const body = parsed;
  if (body.contentRevision !== server.contentRevision) {
    return {
      ok: false,
      httpStatus: 409,
      code: "content_revision_conflict",
      message: USER_FACING.workingCopySyncFailed,
    };
  }

  const mergedNodes: Record<string, ProjectNode> = {};
  for (const [id, clientNode] of Object.entries(body.nodes)) {
    const serverNode = server.nodes[id];
    mergedNodes[id] =
      serverNode === undefined ? adoptNewNode(clientNode) : mergeExistingNode(serverNode, clientNode);
  }

  const timestamp = (options?.now ?? new Date()).toISOString();
  const project: CanvasProjectFile = {
    ...structuredClone(server),
    nodes: mergedNodes,
    edges: structuredClone(body.edges),
    groups: structuredClone(body.groups),
    contentRevision: server.contentRevision + 1,
    updatedAt: timestamp,
  };

  markInputsChangedWhileRunning(project);

  return {
    ok: true,
    project,
    executionRevisions: executionRevisionsOf(project.nodes),
  };
}
