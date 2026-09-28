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

/**
 * 真 Comfy 执行器。下面的路径和字段都是拟定，未验证。
 * 没有对照用户那台 ComfyUI 核实之前，不要把它们写成已验证，也不要写成已经能出图。
 * 本会话没有连过用户的 5090。
 */
export class ComfyHttpExecutor implements ComfyExecutor {
  private readonly cache = new Map<string, ComfyPromptInspect>();
  private readonly baseUrl: () => string | null;

  constructor(options: { baseUrl: () => string | null }) {
    this.baseUrl = options.baseUrl;
  }

  /** 同步缓存，不是对 Comfy 的已核实查询。没见过就不能证明仍在跑。 */
  inspectPrompt(promptId: string): ComfyPromptInspect {
    return this.cache.get(promptId) ?? { kind: "unreachable" };
  }

  async uploadImage(input: ComfyUploadInput): Promise<ComfyUploadResult> {
    // POST /upload/image 的表单字段名 image 为拟定，未验证。
    const filename = safeUploadName(input.filename);
    const form = multipartImage(filename, input.mime, input.bytes);
    const res = await this.request("/upload/image", {
      method: "POST",
      headers: { "content-type": form.contentType },
      body: form.body,
    });
    if (res.status < 200 || res.status >= 300) {
      throw new Error("upload");
    }
    const body = await readJson(res);
    const name = body !== null && typeof body === "object" && typeof (body as { name?: unknown }).name === "string"
      ? (body as { name: string }).name
      : "";
    if (name.length === 0) {
      throw new Error("upload");
    }
    return { name };
  }

  async submit(input: ComfySubmitInput): Promise<ComfySubmitResult> {
    // POST /prompt 的请求体字段 prompt、响应字段 prompt_id 为拟定，未验证。
    const res = await this.request("/prompt", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: input.prompt }),
    });
    if (res.status < 200 || res.status >= 300) {
      throw new Error("rejected");
    }
    const body = await readJson(res);
    const promptId = body !== null && typeof body === "object" && typeof (body as { prompt_id?: unknown }).prompt_id === "string"
      ? (body as { prompt_id: string }).prompt_id
      : "";
    if (promptId.length === 0) {
      throw new Error("rejected");
    }
    this.cache.set(promptId, { kind: "queued" });
    return { promptId };
  }

  async wait(promptId: string, signal: AbortSignal): Promise<ComfyWaitResult> {
    while (!signal.aborted) {
      try {
        const res = await this.request(`/history/${encodeURIComponent(promptId)}`, { method: "GET" });
        if (res.status >= 200 && res.status < 300) {
          const body = await readJson(res);
          const interpreted = interpretHistory(promptId, body);
          if (interpreted.kind === "pending") {
            this.cache.set(promptId, { kind: "running" });
          } else if (interpreted.kind === "failed") {
            this.cache.set(promptId, { kind: "missing" });
            return { ok: false, code: interpreted.code, message: interpreted.message };
          } else {
            const images = await this.fetchImages(interpreted.images);
            this.cache.set(promptId, { kind: "succeeded", images });
            return { ok: true, images };
          }
        }
      } catch {
        // 单次查询失败继续等。不把响应或异常写进日志。
      }
      if (await sleepOrAbort(signal, 400)) {
        break;
      }
    }
    return { ok: false, code: "cancelled", message: USER_FACING.cancelledNoResult };
  }

  async interrupt(promptId: string): Promise<void> {
    // POST /interrupt 空正文为拟定，未验证。promptId 不放进正文，失败也不写日志。
    void promptId;
    try {
      await this.request("/interrupt", { method: "POST" });
    } catch {
      // 忽略。
    }
  }

  private async fetchImages(
    specs: readonly { filename: string; subfolder: string; type: string }[],
  ): Promise<ComfyImage[]> {
    const images: ComfyImage[] = [];
    for (const spec of specs) {
      // GET /view 的查询参数名为拟定，未验证。
      const query = new URLSearchParams({
        filename: spec.filename,
        subfolder: spec.subfolder,
        type: spec.type,
      });
      const res = await this.request(`/view?${query.toString()}`, { method: "GET" });
      if (res.status < 200 || res.status >= 300) {
        throw new Error("view");
      }
      const raw = new Uint8Array(await res.arrayBuffer());
      const mimeHeader = res.headers.get("content-type");
      const mime = mimeHeader !== null && mimeHeader.length > 0 ? mimeHeader.split(";")[0]?.trim() ?? "image/png" : "image/png";
      images.push({ bytes: raw, mime: mime.length > 0 ? mime : "image/png" });
    }
    return images;
  }

  private async request(path: string, init: RequestInit): Promise<Response> {
    const root = normalizeComfyBaseUrl(this.baseUrl() ?? "");
    if (root.length === 0) {
      throw new Error("no-base");
    }
    return fetch(`${root}${path}`, {
      ...init,
      redirect: "manual",
    });
  }
}

function safeUploadName(name: string | undefined): string {
  const base = name?.split(/[/\\]/).pop() ?? "upload.png";
  const cleaned = base.replace(/[^A-Za-z0-9._-]/g, "");
  return cleaned.length > 0 ? cleaned : "upload.png";
}

function multipartImage(filename: string, mime: string, bytes: Uint8Array): { body: Uint8Array; contentType: string } {
  const boundary = `canvas${Math.random().toString(16).slice(2)}`;
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="image"; filename="${filename}"\r\nContent-Type: ${mime || "application/octet-stream"}\r\n\r\n`,
    "utf8",
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`, "utf8");
  const body = Buffer.concat([head, Buffer.from(bytes), tail]);
  return {
    body: Uint8Array.from(body),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

async function readJson(res: Response): Promise<unknown> {
  const text = await res.text();
  if (text.trim().length === 0) {
    return null;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

type HistoryView =
  | { kind: "pending" }
  | { kind: "failed"; code: "failed" | "no-image"; message: string }
  | { kind: "images"; images: Array<{ filename: string; subfolder: string; type: string }> };

function interpretHistory(promptId: string, body: unknown): HistoryView {
  // GET /history/{prompt_id} 的 status、outputs、images 字段位置为拟定，未验证。
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return { kind: "pending" };
  }
  const entry = (body as Record<string, unknown>)[promptId];
  if (entry === undefined) {
    return { kind: "pending" };
  }
  if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
    return { kind: "failed", code: "failed", message: USER_FACING.comfyFailed };
  }
  const status = (entry as { status?: unknown }).status;
  const statusStr = status !== null && typeof status === "object" ? (status as { status_str?: unknown }).status_str : undefined;
  const completed = status !== null && typeof status === "object" && (status as { completed?: unknown }).completed === true;
  if (statusStr === "error") {
    return { kind: "failed", code: "failed", message: USER_FACING.comfyFailed };
  }
  if (!completed && statusStr !== "success") {
    return { kind: "pending" };
  }
  const images = collectImages((entry as { outputs?: unknown }).outputs);
  if (images.length === 0) {
    return { kind: "failed", code: "no-image", message: USER_FACING.comfyNoImage };
  }
  return { kind: "images", images };
}

function collectImages(outputs: unknown): Array<{ filename: string; subfolder: string; type: string }> {
  if (outputs === null || typeof outputs !== "object" || Array.isArray(outputs)) {
    return [];
  }
  const found: Array<{ filename: string; subfolder: string; type: string }> = [];
  for (const value of Object.values(outputs as Record<string, unknown>)) {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      continue;
    }
    const images = (value as { images?: unknown }).images;
    if (!Array.isArray(images)) {
      continue;
    }
    for (const image of images) {
      if (image === null || typeof image !== "object" || Array.isArray(image)) {
        continue;
      }
      const filename = (image as { filename?: unknown }).filename;
      if (typeof filename !== "string" || filename.length === 0) {
        continue;
      }
      const subfolder = (image as { subfolder?: unknown }).subfolder;
      const type = (image as { type?: unknown }).type;
      found.push({
        filename,
        subfolder: typeof subfolder === "string" ? subfolder : "",
        type: typeof type === "string" && type.length > 0 ? type : "output",
      });
    }
  }
  return found;
}

function sleepOrAbort(signal: AbortSignal, ms: number): Promise<boolean> {
  if (signal.aborted) {
    return Promise.resolve(true);
  }
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve(false);
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      resolve(true);
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}
