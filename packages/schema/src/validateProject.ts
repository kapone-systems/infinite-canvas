import {
  findForbiddenDataUri,
  findForbiddenKey,
} from "./forbiddenKeys.ts";
import { findInvalidProjectRelPath } from "./projectRelPath.ts";
import { isTextOverLimit, textOverLimitIssue } from "./textLimit.ts";
import type {
  Camera,
  CanvasProjectFile,
  MediaKind,
  ProjectEdge,
  ProjectGroup,
  ProjectNode,
  SchemaIssue,
  SlotRole,
} from "./types.ts";
import {
  FRESHNESSES,
  MEDIA_HASH_ALGORITHM,
  MEDIA_KINDS,
  NODE_KINDS,
  ORIGINS,
  PHASES,
  PROJECT_FORMAT,
  SCHEMA_VERSION,
  SLOT_ROLES,
} from "./types.ts";
import { USER_FACING } from "./userFacingMessages.ts";

export type ValidateProjectResult =
  | { ok: true; project: CanvasProjectFile }
  | SchemaIssue;

export function isIssue(value: object): value is SchemaIssue {
  return "ok" in value && (value as { ok: unknown }).ok === false;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isMember<T extends string>(
  value: unknown,
  allowed: readonly T[],
): value is T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value);
}

function fail(
  httpStatus: SchemaIssue["httpStatus"],
  code: SchemaIssue["code"],
  message: string,
): SchemaIssue {
  return { ok: false, httpStatus, code, message };
}

function failInvalid(message = USER_FACING.workingCopySyncFailed): SchemaIssue {
  return fail(400, "invalid_project", message);
}

function findAbsolutePathKey(value: unknown): string | null {
  const seen = new Set<object>();
  const visit = (node: unknown): string | null => {
    if (node === null || typeof node !== "object") {
      return null;
    }
    if (seen.has(node)) {
      return null;
    }
    seen.add(node);
    if (Array.isArray(node)) {
      for (const item of node) {
        const found = visit(item);
        if (found !== null) {
          return found;
        }
      }
      return null;
    }
    for (const [key, child] of Object.entries(node)) {
      if (key.toLowerCase() === "absolutepath") {
        return key;
      }
      const found = visit(child);
      if (found !== null) {
        return found;
      }
    }
    return null;
  };
  return visit(value);
}

function findOverlongText(value: unknown): boolean {
  const seen = new Set<object>();
  const visit = (node: unknown): boolean => {
    if (typeof node === "string") {
      return isTextOverLimit(node);
    }
    if (node === null || typeof node !== "object") {
      return false;
    }
    if (seen.has(node)) {
      return false;
    }
    seen.add(node);
    if (Array.isArray(node)) {
      return node.some(visit);
    }
    return Object.values(node).some(visit);
  };
  return visit(value);
}

export function policyIssue(value: unknown): SchemaIssue | null {
  const forbidden = findForbiddenKey(value);
  if (forbidden !== null) {
    return fail(400, "forbidden_key", USER_FACING.workingCopySyncFailed);
  }
  const dataUri = findForbiddenDataUri(value);
  if (dataUri !== null) {
    return fail(400, "data_uri", USER_FACING.workingCopySyncFailed);
  }
  const absolutePath = findAbsolutePathKey(value);
  if (absolutePath !== null) {
    return fail(400, "absolute_path", USER_FACING.workingCopySyncFailed);
  }
  const badPath = findInvalidProjectRelPath(value);
  if (badPath !== null) {
    return fail(400, "invalid_rel_path", USER_FACING.workingCopySyncFailed);
  }
  if (findOverlongText(value)) {
    return textOverLimitIssue();
  }
  return null;
}

function schemaVersionIssue(value: unknown): SchemaIssue | null {
  if (!isRecord(value)) {
    return fail(
      422,
      "schema_version_unsupported",
      USER_FACING.schemaVersionUnsupported,
    );
  }
  if (!Object.hasOwn(value, "schemaVersion")) {
    return fail(
      422,
      "schema_version_unsupported",
      USER_FACING.schemaVersionUnsupported,
    );
  }
  const version = value.schemaVersion;
  if (typeof version === "number" && Number.isFinite(version) && version > SCHEMA_VERSION) {
    return fail(422, "schema_version_newer", USER_FACING.schemaVersionNewer);
  }
  if (version !== SCHEMA_VERSION) {
    return fail(
      422,
      "schema_version_unsupported",
      USER_FACING.schemaVersionUnsupported,
    );
  }
  return null;
}

function parseCamera(value: unknown): Camera | SchemaIssue {
  if (!isRecord(value)) {
    return failInvalid();
  }
  if (!isFiniteNumber(value.x) || !isFiniteNumber(value.y) || !isFiniteNumber(value.zoom)) {
    return failInvalid();
  }
  return { x: value.x, y: value.y, zoom: value.zoom };
}

function parseNode(id: string, value: unknown): ProjectNode | SchemaIssue {
  if (!isRecord(value)) {
    return failInvalid();
  }
  if (value.id !== id || !isNonEmptyString(value.id)) {
    return failInvalid();
  }
  if (!isMember(value.kind, NODE_KINDS)) {
    return failInvalid();
  }
  if (typeof value.title !== "string") {
    return failInvalid();
  }
  if (
    !isFiniteNumber(value.x) ||
    !isFiniteNumber(value.y) ||
    !isFiniteNumber(value.width) ||
    !isFiniteNumber(value.height) ||
    !isFiniteNumber(value.z)
  ) {
    return failInvalid();
  }
  if (value.groupId !== null && typeof value.groupId !== "string") {
    return failInvalid();
  }
  if (!isMember(value.origin, ORIGINS)) {
    return failInvalid();
  }
  if (typeof value.createdAt !== "string" || typeof value.updatedAt !== "string") {
    return failInvalid();
  }
  if (!isFiniteNumber(value.outputRevision)) {
    return failInvalid();
  }
  if (value.text !== undefined && typeof value.text !== "string") {
    return failInvalid();
  }
  if (value.promptDraft !== undefined && typeof value.promptDraft !== "string") {
    return failInvalid();
  }
  if (
    value.outputKind !== undefined &&
    value.outputKind !== null &&
    !isMember(value.outputKind, MEDIA_KINDS)
  ) {
    return failInvalid();
  }
  if (value.phase !== undefined && !isMember(value.phase, PHASES)) {
    return failInvalid();
  }
  if (value.freshness !== undefined && !isMember(value.freshness, FRESHNESSES)) {
    return failInvalid();
  }
  return value as unknown as ProjectNode;
}

function parseEdge(id: string, value: unknown): ProjectEdge | SchemaIssue {
  if (!isRecord(value)) {
    return failInvalid();
  }
  if (value.id !== id || !isNonEmptyString(value.id)) {
    return failInvalid();
  }
  if (
    !isNonEmptyString(value.sourceNodeId) ||
    !isNonEmptyString(value.targetNodeId) ||
    !isNonEmptyString(value.targetSlotId)
  ) {
    return failInvalid();
  }
  if (!isMember(value.role, SLOT_ROLES)) {
    return failInvalid();
  }
  return value as unknown as ProjectEdge;
}

function parseGroup(id: string, value: unknown): ProjectGroup | SchemaIssue {
  if (!isRecord(value)) {
    return failInvalid();
  }
  if (value.id !== id || !isNonEmptyString(value.id)) {
    return failInvalid();
  }
  if (typeof value.title !== "string") {
    return failInvalid();
  }
  if (!Array.isArray(value.childIds) || value.childIds.some((item) => typeof item !== "string")) {
    return failInvalid();
  }
  return value as unknown as ProjectGroup;
}

export function parseNodeMap(
  value: unknown,
): Record<string, ProjectNode> | SchemaIssue {
  if (!isRecord(value)) {
    return failInvalid();
  }
  const nodes: Record<string, ProjectNode> = {};
  for (const [id, raw] of Object.entries(value)) {
    const parsed = parseNode(id, raw);
    if (isIssue(parsed)) {
      return parsed;
    }
    nodes[id] = parsed;
  }
  return nodes;
}

export function parseEdgeMap(
  value: unknown,
): Record<string, ProjectEdge> | SchemaIssue {
  if (!isRecord(value)) {
    return failInvalid();
  }
  const edges: Record<string, ProjectEdge> = {};
  for (const [id, raw] of Object.entries(value)) {
    const parsed = parseEdge(id, raw);
    if (isIssue(parsed)) {
      return parsed;
    }
    edges[id] = parsed;
  }
  return edges;
}

export function parseGroupMap(
  value: unknown,
): Record<string, ProjectGroup> | SchemaIssue {
  if (!isRecord(value)) {
    return failInvalid();
  }
  const groups: Record<string, ProjectGroup> = {};
  for (const [id, raw] of Object.entries(value)) {
    const parsed = parseGroup(id, raw);
    if (isIssue(parsed)) {
      return parsed;
    }
    groups[id] = parsed;
  }
  return groups;
}

/**
 * 打开 / 保存前的工程校验。
 * schemaVersion 缺失或不是 1 → 422（第 11.1 节两句）。
 * 密钥键、data: 前缀、非法路径、超长文本 → 400。
 */
export function validateProject(input: unknown): ValidateProjectResult {
  const versionIssue = schemaVersionIssue(input);
  if (versionIssue !== null) {
    return versionIssue;
  }
  const policy = policyIssue(input);
  if (policy !== null) {
    return policy;
  }
  if (!isRecord(input)) {
    return failInvalid();
  }
  if (input.format !== PROJECT_FORMAT) {
    return failInvalid();
  }
  if (input.mediaHashAlgorithm !== MEDIA_HASH_ALGORITHM) {
    return failInvalid();
  }
  if (!isNonEmptyString(input.projectId) || typeof input.name !== "string") {
    return failInvalid();
  }
  if (
    !Number.isInteger(input.contentRevision) ||
    (input.contentRevision as number) < 0 ||
    !Number.isInteger(input.savedContentRevision) ||
    (input.savedContentRevision as number) < 0 ||
    !Number.isInteger(input.nextSerial) ||
    (input.nextSerial as number) < 0
  ) {
    return failInvalid();
  }
  if (typeof input.createdAt !== "string" || typeof input.updatedAt !== "string") {
    return failInvalid();
  }
  if (input.viewport !== null && input.viewport !== undefined) {
    const parsedViewport = parseCamera(input.viewport);
    if (isIssue(parsedViewport)) {
      return parsedViewport;
    }
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
    ok: true,
    project: input as unknown as CanvasProjectFile,
  };
}

export function isSlotRole(value: unknown): value is SlotRole {
  return isMember(value, SLOT_ROLES);
}

export function isMediaKind(value: unknown): value is MediaKind {
  return isMember(value, MEDIA_KINDS);
}
