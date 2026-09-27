import type { Camera, CanvasProjectFile, MediaRef, WorkingCopyPutBody } from "@canvas/schema";
import { COPY } from "../ui/copy.ts";
import { HEALTH_DEADLINE_MS } from "../canvas/metrics.ts";

export type ApiOk<T> = { ok: true; status: number; data: T };
export type ApiErr = { ok: false; status: number; message: string; network: boolean };
export type ApiResult<T> = ApiOk<T> | ApiErr;

function assertNoTokenInUrl(path: string): void {
  if (path.includes("token=")) {
    throw new Error("session token must not appear in the URL");
  }
}

function messageFromBody(body: unknown, fallback: string): string {
  if (body !== null && typeof body === "object" && "message" in body) {
    const value = (body as { message: unknown }).message;
    if (typeof value === "string" && value.length > 0) {
      return value;
    }
  }
  return fallback;
}

function workingCopyFromHeaders(headers: Headers): WorkingCopyResponse | undefined {
  const rev = headers.get("X-Content-Revision");
  if (rev === null || rev.length === 0) {
    return undefined;
  }
  const contentRevision = Number(rev);
  if (!Number.isFinite(contentRevision)) {
    return undefined;
  }
  const execRaw = headers.get("X-Execution-Revisions");
  let executionRevisions: Record<string, number> | undefined;
  if (execRaw !== null && execRaw.length > 0) {
    try {
      executionRevisions = JSON.parse(execRaw) as Record<string, number>;
    } catch {
      executionRevisions = undefined;
    }
  }
  return { contentRevision, executionRevisions };
}

export async function requestJson(
  path: string,
  init: RequestInit,
): Promise<ApiResult<unknown>> {
  assertNoTokenInUrl(path);
  try {
    const res = await fetch(path, {
      cache: "no-store",
      ...init,
    });
    const text = await res.text();
    let parsed: unknown = undefined;
    if (text.length > 0) {
      try {
        parsed = JSON.parse(text) as unknown;
      } catch {
        parsed = undefined;
      }
    }
    if (parsed === undefined && res.status === 204) {
      parsed = workingCopyFromHeaders(res.headers);
    }
    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        message: messageFromBody(parsed, COPY.backendNeverConnected),
        network: false,
      };
    }
    return { ok: true, status: res.status, data: parsed };
  } catch {
    return {
      ok: false,
      status: 0,
      message: COPY.backendNeverConnected,
      network: true,
    };
  }
}

export function apiHeaders(token: string, jsonBody: boolean): Headers {
  const headers = new Headers();
  headers.set("Authorization", `Bearer ${token}`);
  if (jsonBody) {
    headers.set("Content-Type", "application/json");
  }
  return headers;
}

export async function probeHealth(deadlineMs = HEALTH_DEADLINE_MS): Promise<boolean> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => {
    controller.abort();
  }, deadlineMs);
  try {
    const res = await fetch("/health", {
      method: "GET",
      cache: "no-store",
      signal: controller.signal,
    });
    if (!res.ok) {
      return false;
    }
    const body: unknown = await res.json();
    return (
      typeof body === "object" &&
      body !== null &&
      (body as { ok?: unknown }).ok === true
    );
  } catch {
    return false;
  } finally {
    window.clearTimeout(timer);
  }
}

export type CurrentProjectResponse = {
  project: CanvasProjectFile;
  dirty: boolean;
  absolutePath: string;
  message?: string;
  autosaveError?: { message: string };
  missingMedia?: string[];
};

export type CreatedProjectResponse = {
  projectId: string;
  name: string;
  absolutePath: string;
  project: CanvasProjectFile;
};

export type OpenedProjectResponse = {
  absolutePath: string;
  project: CanvasProjectFile;
  dirty: boolean;
  message?: string;
  missingMedia?: string[];
};

export type SaveResponse = {
  contentRevision: number;
  savedContentRevision: number;
};

export type WorkingCopyResponse = {
  contentRevision: number;
  executionRevisions?: Record<string, number>;
};

export async function getCurrentProject(token: string): Promise<ApiResult<CurrentProjectResponse>> {
  const result = await requestJson("/api/projects/current", {
    method: "GET",
    headers: apiHeaders(token, false),
  });
  if (!result.ok) {
    return result;
  }
  return { ok: true, status: result.status, data: result.data as CurrentProjectResponse };
}

export async function createProject(
  token: string,
  input: { parentDir: string; name: string },
): Promise<ApiResult<CreatedProjectResponse>> {
  const result = await requestJson("/api/projects", {
    method: "POST",
    headers: apiHeaders(token, true),
    body: JSON.stringify(input),
  });
  if (!result.ok) {
    return result;
  }
  return { ok: true, status: result.status, data: result.data as CreatedProjectResponse };
}

export async function openProject(
  token: string,
  input: { absolutePath: string },
): Promise<ApiResult<OpenedProjectResponse>> {
  const result = await requestJson("/api/projects/open", {
    method: "POST",
    headers: apiHeaders(token, true),
    body: JSON.stringify(input),
  });
  if (!result.ok) {
    return result;
  }
  return { ok: true, status: result.status, data: result.data as OpenedProjectResponse };
}

export async function emptyProjectTrash(token: string): Promise<ApiResult<{ ok: true }>> {
  const result = await requestJson("/api/projects/current/trash/empty", {
    method: "POST",
    headers: apiHeaders(token, true),
    body: "{}",
  });
  if (!result.ok) {
    return result;
  }
  return { ok: true, status: result.status, data: { ok: true } };
}

export async function saveCurrentProject(token: string, contentRevision?: number): Promise<ApiResult<SaveResponse>> {
  const result = await requestJson("/api/projects/current", {
    method: "PUT",
    headers: apiHeaders(token, contentRevision !== undefined),
    body: contentRevision === undefined ? undefined : JSON.stringify({ contentRevision }),
  });
  if (!result.ok) {
    return result;
  }
  return { ok: true, status: result.status, data: result.data as SaveResponse };
}

export async function saveProjectAs(
  token: string,
  input: { parentDir: string; name: string },
): Promise<ApiResult<CreatedProjectResponse>> {
  const result = await requestJson("/api/projects/current/save-as", {
    method: "POST",
    headers: apiHeaders(token, true),
    body: JSON.stringify(input),
  });
  if (!result.ok) {
    return result;
  }
  return { ok: true, status: result.status, data: result.data as CreatedProjectResponse };
}

export async function putViewport(token: string, camera: Camera): Promise<ApiResult<undefined>> {
  const result = await requestJson("/api/projects/current/viewport", {
    method: "PUT",
    headers: apiHeaders(token, true),
    body: JSON.stringify(camera),
  });
  if (!result.ok) {
    return result;
  }
  return { ok: true, status: result.status, data: undefined };
}

export type MediaTicketPurpose = "thumb" | "cover" | "proxy" | "original" | "audio";

export type MediaTicketResponse = {
  ticketId: string;
  expiresAt: string;
};

export async function requestMediaTicket(
  token: string,
  input: { relativePath: string; purpose: MediaTicketPurpose },
): Promise<ApiResult<MediaTicketResponse>> {
  const result = await requestJson("/api/projects/current/media-tickets", {
    method: "POST",
    headers: apiHeaders(token, true),
    body: JSON.stringify(input),
  });
  if (!result.ok) {
    return result;
  }
  const data = result.data as MediaTicketResponse | undefined;
  if (data === undefined || typeof data.ticketId !== "string") {
    return {
      ok: false,
      status: result.status,
      message: COPY.thumbFailed,
      network: false,
    };
  }
  return { ok: true, status: result.status, data };
}

export async function putWorkingCopy(
  token: string,
  body: WorkingCopyPutBody,
): Promise<ApiResult<WorkingCopyResponse>> {
  const result = await requestJson("/api/projects/current/working-copy", {
    method: "PUT",
    headers: apiHeaders(token, true),
    body: JSON.stringify(body),
  });
  if (!result.ok) {
    return result;
  }
  const data = result.data as WorkingCopyResponse | undefined;
  if (data === undefined || typeof data.contentRevision !== "number") {
    return {
      ok: false,
      status: result.status,
      message: COPY.workingCopySyncFailed,
      network: false,
    };
  }
  return { ok: true, status: result.status, data };
}

export type IngestMediaResponse = { media: MediaRef };

/** 字段必须叫 file。先入库再建节点。近景禁止 blob 原件地址。 */
export async function ingestMediaFile(
  token: string,
  file: Blob,
  filename?: string,
): Promise<ApiResult<IngestMediaResponse>> {
  const body = new FormData();
  body.append("file", file, filename);
  try {
    const headers = new Headers();
    headers.set("Authorization", `Bearer ${token}`);
    const res = await fetch("/api/projects/current/media/ingest", {
      method: "POST",
      cache: "no-store",
      headers,
      body,
    });
    const text = await res.text();
    let parsed: unknown = undefined;
    if (text.length > 0) {
      try {
        parsed = JSON.parse(text) as unknown;
      } catch {
        parsed = undefined;
      }
    }
    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        message: messageFromBody(parsed, COPY.ingestFailed),
        network: false,
      };
    }
    const data = parsed as IngestMediaResponse | undefined;
    if (data === undefined || data.media === undefined) {
      return {
        ok: false,
        status: res.status,
        message: COPY.ingestFailed,
        network: false,
      };
    }
    return { ok: true, status: res.status, data };
  } catch {
    return {
      ok: false,
      status: 0,
      message: COPY.backendNeverConnected,
      network: true,
    };
  }
}
