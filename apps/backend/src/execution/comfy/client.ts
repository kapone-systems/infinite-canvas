/**
 * 方案第 9.8 节：唯一调用 Comfy 的模块。允许替身。
 * 请求体、上传字段、history 取图位置均为拟定，核实前不要标成已验证。
 * 浏览器不得直连；不要把 /prompt 暴露给页面。
 */
import { USER_FACING } from "@canvas/schema";

export type ComfyProbeResult = {
  reachable: boolean;
  message: string;
};

export type ComfyReachability = {
  probe: (baseUrl: string) => Promise<ComfyProbeResult>;
};

export type ComfyImage = {
  bytes: Uint8Array;
  mime: string;
};

export type ComfySubmitInput = {
  taskId: string;
  /** 入队时快照的提示词。submit 不得再读工作副本。 */
  promptText: string;
  /** 已填槽的 API 格式。字段名未对照本机核实。 */
  prompt: Record<string, unknown>;
  variantIndex?: number;
};

export type ComfyUploadInput = {
  bytes: Uint8Array;
  mime: string;
  filename?: string;
};

export type ComfyUploadResult = {
  name: string;
};

export type ComfySubmitResult = {
  promptId: string;
};

export type ComfyWaitResult =
  | { ok: true; images: ComfyImage[] }
  | {
      ok: false;
      code: "rejected" | "failed" | "no-image" | "cancelled";
      message: string;
    };

/**
 * 重启对账用的队列/历史结果。夹具同步返回，不打真实 Comfy，也不打外网。
 * 未实现 inspectPrompt 时，不能证明任务仍在跑。
 */
export type ComfyPromptInspect =
  | { kind: "queued" | "running" }
  | { kind: "succeeded"; images: ComfyImage[] }
  | { kind: "missing" }
  | { kind: "unreachable" };

/**
 * 只替 POST /prompt 与取图。预检走 ComfyReachability，有 FakeExecutor 也不能跳过预检。
 */
export interface ComfyExecutor {
  submit(input: ComfySubmitInput): Promise<ComfySubmitResult>;
  wait(promptId: string, signal: AbortSignal): Promise<ComfyWaitResult>;
  interrupt(promptId: string): Promise<void>;
  uploadImage(input: ComfyUploadInput): Promise<ComfyUploadResult>;
  /** 只读队列/历史。没有这个方法就不能证明仍在跑，不得因此 submit。 */
  inspectPrompt?(promptId: string): ComfyPromptInspect;
}

export function normalizeComfyBaseUrl(raw: string): string {
  return raw.trim().replace(/\/+$/, "");
}

/**
 * 只接受本机 URL：http(s)://127.0.0.1|localhost|::1[:port]
 */
export function parseLocalComfyBaseUrl(
  value: unknown,
): { ok: true; url: string | null } | { ok: false } {
  if (value === null) {
    return { ok: true, url: null };
  }
  if (typeof value !== "string") {
    return { ok: false };
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return { ok: true, url: null };
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false };
  }
  if (parsed.username !== "" || parsed.password !== "") {
    return { ok: false };
  }
  const host = parsed.hostname.replace(/^\[(.*)\]$/, "$1").toLowerCase();
  if (host !== "127.0.0.1" && host !== "localhost" && host !== "::1") {
    return { ok: false };
  }
  if (parsed.pathname !== "/" && parsed.pathname !== "") {
    return { ok: false };
  }
  return { ok: true, url: parsed.origin };
}

export async function probeComfyHttp(baseUrl: string): Promise<ComfyProbeResult> {
  const root = normalizeComfyBaseUrl(baseUrl);
  if (root.length === 0) {
    return { reachable: false, message: USER_FACING.comfyUnconfigured };
  }
  // GET /object_info 路径已见公开文档；成功形状未对照本机核实。
  const target = `${root}/object_info`;
  try {
    const res = await fetch(target, {
      method: "GET",
      redirect: "manual",
      signal: AbortSignal.timeout(2500),
    });
    if (res.status >= 200 && res.status < 400) {
      return { reachable: true, message: "" };
    }
    return { reachable: false, message: USER_FACING.comfyUnreachable };
  } catch {
    return { reachable: false, message: USER_FACING.comfyUnreachable };
  }
}

export const realComfyReachability: ComfyReachability = {
  probe: probeComfyHttp,
};
