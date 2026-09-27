import type { RecipeSummary, RunRequest, RunSnapshot, TaskRecord } from "@canvas/schema";
import { apiHeaders, requestJson, type ApiResult } from "../api/client.ts";

export const EXECUTION_RUNS_PATH = "/api/execution/runs";

export async function postRun(token: string, request: RunRequest): Promise<ApiResult<RunSnapshot>> {
  const result = await requestJson(EXECUTION_RUNS_PATH, {
    method: "POST",
    headers: apiHeaders(token, true),
    body: JSON.stringify(request),
  });
  if (!result.ok) {
    return result;
  }
  return { ok: true, status: result.status, data: result.data as RunSnapshot };
}

export async function getRun(token: string, runId: string): Promise<ApiResult<RunSnapshot>> {
  const result = await requestJson(`${EXECUTION_RUNS_PATH}/${encodeURIComponent(runId)}`, {
    method: "GET",
    headers: apiHeaders(token, false),
  });
  if (!result.ok) {
    return result;
  }
  return { ok: true, status: result.status, data: result.data as RunSnapshot };
}

export async function cancelTask(token: string, taskId: string): Promise<ApiResult<TaskRecord & { message?: string }>> {
  const result = await requestJson(`/api/execution/tasks/${encodeURIComponent(taskId)}/cancel`, {
    method: "POST",
    headers: apiHeaders(token, false),
  });
  if (!result.ok) {
    return result;
  }
  return { ok: true, status: result.status, data: result.data as TaskRecord & { message?: string } };
}

export async function retryFailed(token: string, runId: string): Promise<ApiResult<RunSnapshot>> {
  const result = await requestJson(`${EXECUTION_RUNS_PATH}/${encodeURIComponent(runId)}/retry-failed`, {
    method: "POST",
    headers: apiHeaders(token, false),
  });
  if (!result.ok) {
    return result;
  }
  return { ok: true, status: result.status, data: result.data as RunSnapshot };
}

export async function regeneratePreview(token: string, nodeId: string): Promise<ApiResult<{ ok: true }>> {
  const result = await requestJson(`/api/execution/nodes/${encodeURIComponent(nodeId)}/regenerate-preview`, {
    method: "POST",
    headers: apiHeaders(token, false),
  });
  if (!result.ok) {
    return result;
  }
  return { ok: true, status: result.status, data: { ok: true } };
}

export async function getRecipes(token: string): Promise<ApiResult<RecipeSummary[]>> {
  const result = await requestJson("/api/execution/recipes", {
    method: "GET",
    headers: apiHeaders(token, false),
  });
  if (!result.ok) {
    return result;
  }
  return { ok: true, status: result.status, data: result.data as RecipeSummary[] };
}

export type AppConfigResponse = {
  comfyBaseUrl: string | null;
  ffmpeg: string;
  ffprobe: string;
  ffmpegVersion: string | null;
};

export async function getAppConfig(token: string): Promise<ApiResult<AppConfigResponse>> {
  const result = await requestJson("/api/app/config", {
    method: "GET",
    headers: apiHeaders(token, false),
  });
  if (!result.ok) {
    return result;
  }
  return { ok: true, status: result.status, data: result.data as AppConfigResponse };
}

export async function putComfyBaseUrl(
  token: string,
  comfyBaseUrl: string | null,
): Promise<ApiResult<undefined>> {
  const result = await requestJson("/api/app/comfy-base-url", {
    method: "PUT",
    headers: apiHeaders(token, true),
    body: JSON.stringify({ comfyBaseUrl }),
  });
  if (!result.ok) {
    return result;
  }
  return { ok: true, status: result.status, data: undefined };
}

export type ComfyProbeResponse = { reachable: boolean; message: string };

export async function recheckComfy(token: string): Promise<ApiResult<ComfyProbeResponse>> {
  const result = await requestJson("/api/execution/comfy/recheck", {
    method: "POST",
    headers: apiHeaders(token, false),
  });
  if (!result.ok) {
    return result;
  }
  return { ok: true, status: result.status, data: result.data as ComfyProbeResponse };
}

export const SETTINGS_SECRET_PROVIDER_ID = "example.cloud";

export async function getSecretPresent(
  token: string,
  providerId: string,
  account = "default",
): Promise<ApiResult<{ present: boolean }>> {
  const query = new URLSearchParams({ account });
  const result = await requestJson(
    `/api/secrets/${encodeURIComponent(providerId)}?${query.toString()}`,
    {
      method: "GET",
      headers: apiHeaders(token, false),
    },
  );
  if (!result.ok) {
    return result;
  }
  const body = result.data;
  const present = body !== null && typeof body === "object" && "present" in body
    ? (body as { present: unknown }).present === true
    : false;
  return { ok: true, status: result.status, data: { present } };
}

export async function putSecret(
  token: string,
  input: { providerId: string; account: string; secret: string },
): Promise<ApiResult<undefined>> {
  const result = await requestJson("/api/secrets", {
    method: "PUT",
    headers: apiHeaders(token, true),
    body: JSON.stringify(input),
  });
  if (!result.ok) {
    return result;
  }
  return { ok: true, status: result.status, data: undefined };
}

export async function deleteSecret(
  token: string,
  providerId: string,
  account = "default",
): Promise<ApiResult<undefined>> {
  const query = new URLSearchParams({ account });
  const result = await requestJson(
    `/api/secrets/${encodeURIComponent(providerId)}?${query.toString()}`,
    {
      method: "DELETE",
      headers: apiHeaders(token, false),
    },
  );
  if (!result.ok) {
    return result;
  }
  return { ok: true, status: result.status, data: undefined };
}
