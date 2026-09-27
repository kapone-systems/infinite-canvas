import { BACKEND_MESSAGES } from "../messages.ts";
import type { RunRequest, RunScope } from "@canvas/schema";

const ALLOWED_KEYS = new Set(["projectId", "scope", "force", "clientRequestId"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseScope(value: unknown): RunScope | null {
  if (!isRecord(value) || typeof value.type !== "string") {
    return null;
  }
  if (value.type === "node" || value.type === "downstream") {
    if (typeof value.nodeId !== "string" || value.nodeId.length === 0) {
      return null;
    }
    return { type: value.type, nodeId: value.nodeId };
  }
  if (value.type === "selection") {
    if (!Array.isArray(value.nodeIds) || value.nodeIds.length === 0) {
      return null;
    }
    const nodeIds: string[] = [];
    for (const id of value.nodeIds) {
      if (typeof id !== "string" || id.length === 0) {
        return null;
      }
      nodeIds.push(id);
    }
    return { type: "selection", nodeIds };
  }
  return null;
}

export function parseRunRequest(body: unknown): { ok: true; request: RunRequest } | { ok: false; message: string } {
  if (!isRecord(body)) {
    return { ok: false, message: BACKEND_MESSAGES.invalidJson };
  }
  for (const key of Object.keys(body)) {
    if (!ALLOWED_KEYS.has(key)) {
      return { ok: false, message: BACKEND_MESSAGES.requestFailed };
    }
  }
  if (typeof body.projectId !== "string" || body.projectId.length === 0) {
    return { ok: false, message: BACKEND_MESSAGES.requestFailed };
  }
  if (typeof body.clientRequestId !== "string" || body.clientRequestId.length === 0) {
    return { ok: false, message: BACKEND_MESSAGES.requestFailed };
  }
  if (typeof body.force !== "boolean") {
    return { ok: false, message: BACKEND_MESSAGES.requestFailed };
  }
  const scope = parseScope(body.scope);
  if (scope === null) {
    return { ok: false, message: BACKEND_MESSAGES.requestFailed };
  }
  return {
    ok: true,
    request: {
      projectId: body.projectId,
      scope,
      force: scope.type === "downstream" ? false : body.force,
      clientRequestId: body.clientRequestId,
    },
  };
}
