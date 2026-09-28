import { createServer as createHttpServer, type IncomingMessage, type ServerResponse, type Server } from "node:http";
import { homedir } from "node:os";
import { DEFAULT_LISTEN_PORT, LISTEN_HOST, readAppJsonSync } from "../appData.ts";
import type { ComfyExecutor, ComfyReachability } from "../execution/comfy/client.ts";
import { realComfyReachability } from "../execution/comfy/client.ts";
import type { CloudVideoAdapter } from "../execution/adapters/exampleVideoFixture.ts";
import { createExecutionRuntime, type ExecutionRuntime } from "../execution/runtime.ts";
import { readUseLocalComfySync } from "../execution/useLocalComfy.ts";
import { openTaskStore } from "../execution/taskStore.ts";
import type { FfmpegProbeResult } from "../ffmpegStatus.ts";
import { BACKEND_MESSAGES } from "../messages.ts";
import { defaultForbiddenContext, type ForbiddenLocationContext } from "../project/forbiddenLocations.ts";
import { AUTOSAVE_DELAY_MS, ProjectSession } from "../project/workingCopy.ts";
import { handleAppConfig } from "./appConfig.ts";
import { handleExecution, handleExecutionUpgrade } from "./execution.ts";
import { applyCors, handlePreflight, inspectRequest, redactMediaTicketPath, sendJson } from "./guard.ts";
import { handleHealth } from "./health.ts";
import { handleMediaIngest } from "./ingest.ts";
import { handleIssueMediaTicket, handleMediaTicketGet, MediaTicketStore } from "./mediaTickets.ts";
import { handleProjects } from "./projects.ts";
import { handleSecrets } from "./secrets.ts";
import { handleSshComfy, handleUseLocalComfy } from "./sshComfy.ts";
import { tryServeStatic } from "./staticFiles.ts";
import { createMemorySecretStore } from "../secrets/memorySecretStore.ts";
import type { SecretPlatform, SecretStore } from "../secrets/types.ts";
import { createComfyTunnel, type ComfyTunnel, type SshSpawn } from "../ssh/comfyTunnel.ts";

export const MAX_JSON_BYTES = 16 * 1024 * 1024;

export type BackendOptions = {
  token: string;
  dataDir: string;
  ffmpeg: FfmpegProbeResult;
  now?: () => Date;
  autosaveDelayMs?: number;
  listenPort?: number;
  homeDir?: string;
  /** `--serve-web` 静态根。有值时 GET/HEAD 非 /api、非 /health 免令牌出文件。 */
  webRoot?: string;
  /** 访问日志。路径已丢掉 ticketId，行内不含 Authorization。 */
  accessLog?: (line: string) => void;
  /** 可选。缺省不假出图；有 FakeExecutor 也不能跳过预检。 */
  executor?: ComfyExecutor;
  comfyReachability?: ComfyReachability;
  comfyBaseUrl?: string | null;
  cancelTimeoutMs?: number;
  cloudAdapters?: CloudVideoAdapter[];
  cloudPollIntervalMs?: number;
  /** 生产心跳阈值是代码里的 15000 毫秒，不写进 app.json。测试可注入更短窗口。 */
  cloudHeartbeatStaleMs?: number;
  cloudHeartbeatTickMs?: number;
  deriveVideo?: (input: {
    projectRoot: string;
    media: import("@canvas/schema").MediaRef;
    bytes: Uint8Array;
  }) => Promise<{ ok: true; media: import("@canvas/schema").MediaRef } | { ok: false }>;
  secretPresent?: (ref: { providerId: string; account?: string }) => boolean;
  /** 缺省是内存库。生产进程传入 Windows 实现。测试不要写真实凭据库。 */
  secretStore?: SecretStore;
  /** 有 --fake-executor 时为 false。缺省 false，测试仍走传入的替身。 */
  allowRealComfy?: boolean;
  /** 缺省读 use-local-comfy.json，没有文件当关。 */
  useLocalComfy?: boolean;
  fallbackExecutor?: ComfyExecutor;
  /** 缺省是不碰真实 ssh、不写 Windows 凭据库的隧道。生产进程传入系统 ssh。 */
  sshTunnel?: ComfyTunnel;
  sshPlatform?: SecretPlatform;
  sshSpawn?: SshSpawn;
  sshAvailable?: () => boolean;
  restrictSecretFile?: (filePath: string) => Promise<void>;
};

export type Backend = {
  server: Server;
  session: ProjectSession;
  token: string;
  dataDir: string;
  host: typeof LISTEN_HOST;
  execution: ExecutionRuntime;
  getPort: () => number;
  setPort: (port: number) => void;
  close: () => Promise<void>;
};

function normalizePathname(pathname: string): string {
  if (pathname.length > 1 && pathname.endsWith("/")) {
    return pathname.slice(0, -1);
  }
  return pathname;
}

export function readRequestBody(req: IncomingMessage, limit = MAX_JSON_BYTES): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;
    const fail = (err: Error): void => {
      if (settled) {
        return;
      }
      settled = true;
      reject(err);
    };
    req.on("data", (chunk: Buffer | string) => {
      const buf = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
      size += buf.length;
      if (size > limit) {
        req.destroy();
        fail(Object.assign(new Error("PAYLOAD_TOO_LARGE"), { code: "PAYLOAD_TOO_LARGE" }));
        return;
      }
      chunks.push(buf);
    });
    req.on("end", () => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(Buffer.concat(chunks));
    });
    req.on("error", (err) => {
      fail(err);
    });
  });
}

function parseJsonBody(raw: Buffer): unknown {
  if (raw.length === 0) {
    return undefined;
  }
  const text = raw.toString("utf8");
  if (text.trim().length === 0) {
    return undefined;
  }
  return JSON.parse(text) as unknown;
}

export function createBackend(options: BackendOptions): Backend {
  const session = new ProjectSession({
    now: options.now,
    autosaveDelayMs: options.autosaveDelayMs ?? AUTOSAVE_DELAY_MS,
  });
  const tickets = new MediaTicketStore(options.now ?? (() => new Date()));
  let port = options.listenPort ?? DEFAULT_LISTEN_PORT;
  const forbidden: ForbiddenLocationContext = defaultForbiddenContext(
    options.dataDir,
    options.homeDir ?? homedir(),
  );
  const secretStore = options.secretStore ?? createMemorySecretStore();
  const taskStore = openTaskStore(options.dataDir);
  const initialComfy =
    options.comfyBaseUrl !== undefined
      ? options.comfyBaseUrl
      : (readAppJsonSync(options.dataDir).comfyBaseUrl ?? null);
  const execution = createExecutionRuntime({
    store: taskStore,
    session,
    dataDir: options.dataDir,
    executor: options.executor,
    reachability: options.comfyReachability ?? realComfyReachability,
    comfyBaseUrl: initialComfy,
    now: options.now,
    cancelTimeoutMs: options.cancelTimeoutMs,
    cloudAdapters: options.cloudAdapters,
    cloudPollIntervalMs: options.cloudPollIntervalMs,
    cloudHeartbeatStaleMs: options.cloudHeartbeatStaleMs,
    cloudHeartbeatTickMs: options.cloudHeartbeatTickMs,
    deriveVideo: options.deriveVideo,
    secretPresent: options.secretPresent,
    secretStore,
    allowRealComfy: options.allowRealComfy === true,
    useLocalComfy: options.useLocalComfy ?? readUseLocalComfySync(options.dataDir),
    fallbackExecutor: options.fallbackExecutor ?? options.executor,
  });
  const sshTunnel = options.sshTunnel ?? createComfyTunnel({
    dataDir: options.dataDir,
    platform: options.sshPlatform ?? inertSshPlatform(),
    restrictFile: options.restrictSecretFile ?? (async () => {}),
    spawnSsh: options.sshSpawn,
    sshAvailable: options.sshAvailable ?? (() => false),
  });

  const server = createHttpServer((req: IncomingMessage, res: ServerResponse) => {
    void handleRequest(req, res);
  });
  server.on("upgrade", (req, socket, head) => {
    const handled = handleExecutionUpgrade(req, socket, head, {
      token: options.token,
      port,
      runtime: execution,
    });
    if (!handled) {
      socket.destroy();
    }
  });

  async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      if (handlePreflight(req, res, port)) {
        return;
      }
      applyCors(req, res, port);

      let url: URL;
      try {
        url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
      } catch {
        sendJson(res, 400, { message: BACKEND_MESSAGES.requestFailed });
        return;
      }
      url.pathname = normalizePathname(url.pathname);
      const method = (req.method ?? "GET").toUpperCase();
      if (options.accessLog !== undefined) {
        res.on("finish", () => {
          options.accessLog?.(`${method} ${redactMediaTicketPath(url.pathname)} ${res.statusCode}`);
        });
      }

      const serveWeb = options.webRoot !== undefined && options.webRoot.length > 0;
      const guarded = inspectRequest(req, url, {
        token: options.token,
        port,
        serveWeb,
      });
      if (!guarded.ok) {
        sendJson(res, guarded.status, { message: guarded.message });
        return;
      }

      if (url.pathname === "/health") {
        handleHealth(req, res, options.ffmpeg, execution.comfyHealth());
        return;
      }

      if (await handleMediaTicketGet(req, res, url, { session, tickets })) {
        return;
      }

      if (serveWeb && options.webRoot !== undefined) {
        const served = await tryServeStatic(req, res, url, options.webRoot);
        if (served) {
          return;
        }
      }

      // multipart 必须在 JSON 读体之前吃原始流；退回 handleProjects 会吞掉 /api/projects*。
      if (await handleMediaIngest(req, res, url, { session, now: options.now, dataDir: options.dataDir })) {
        return;
      }

      let body: unknown;
      try {
        const raw = await readRequestBody(req);
        body = parseJsonBody(raw);
      } catch (err) {
        if (typeof err === "object" && err !== null && "code" in err && (err as { code: unknown }).code === "PAYLOAD_TOO_LARGE") {
          sendJson(res, 413, { message: BACKEND_MESSAGES.payloadTooLarge });
          return;
        }
        sendJson(res, 400, { message: BACKEND_MESSAGES.invalidJson });
        return;
      }

      if (await handleIssueMediaTicket(req, res, url, body, { session, tickets })) {
        return;
      }

      if (await handleAppConfig(req, res, url, body, execution, options.ffmpeg, () => sshTunnel.disconnect())) {
        return;
      }

      if (await handleUseLocalComfy(req, res, url, body, { dataDir: options.dataDir, runtime: execution })) {
        return;
      }

      if (await handleSshComfy(req, res, url, body, { tunnel: sshTunnel, runtime: execution })) {
        return;
      }

      if (await handleSecrets(req, res, url, body, secretStore)) {
        return;
      }

      if (await handleExecution(req, res, url, body, execution)) {
        return;
      }

      const handled = await handleProjects(req, res, url, body, {
        session,
        forbidden,
        tickets,
        onProjectOpened: () => {
          execution.reconcileOpenProject();
        },
      });
      if (!handled) {
        sendJson(res, 404, { message: BACKEND_MESSAGES.requestFailed });
      }
    } catch {
      if (!res.headersSent) {
        sendJson(res, 500, { message: BACKEND_MESSAGES.requestFailed });
      }
    }
  }

  return {
    server,
    session,
    token: options.token,
    dataDir: options.dataDir,
    host: LISTEN_HOST,
    execution,
    getPort: () => port,
    setPort: (next) => {
      port = next;
    },
    close: async () => {
      await sshTunnel.shutdown();
      execution.dispose();
      await session.flushAutosave();
      taskStore.close();
      session.clear();
      await new Promise<void>((resolve, reject) => {
        if (typeof server.closeAllConnections === "function") {
          server.closeAllConnections();
        }
        server.close((err) => {
          if (err) {
            reject(err);
            return;
          }
          resolve();
        });
      });
    },
  };
}

function inertSshPlatform(): SecretPlatform {
  const creds = new Map<string, Uint8Array>();
  return {
    credWrite(name, blob) {
      creds.set(name, Uint8Array.from(blob));
    },
    credRead(name) {
      const found = creds.get(name);
      return found === undefined ? null : Uint8Array.from(found);
    },
    credDelete(name) {
      creds.delete(name);
    },
    protectData(plain) {
      const out = new Uint8Array(plain.byteLength + 1);
      out[0] = 0x5a;
      for (let i = 0; i < plain.byteLength; i += 1) {
        out[i + 1] = (plain[i] ?? 0) ^ 0xff;
      }
      return out;
    },
    unprotectData(cipher) {
      const out = new Uint8Array(Math.max(0, cipher.byteLength - 1));
      for (let i = 0; i < out.byteLength; i += 1) {
        out[i] = (cipher[i + 1] ?? 0) ^ 0xff;
      }
      return out;
    },
  };
}

export const STUB_FFMPEG: FfmpegProbeResult = {
  ffmpeg: "missing",
  ffprobe: "missing",
  ffmpegVersion: null,
};

export async function startBackend(options: BackendOptions): Promise<{
  backend: Backend;
  port: number;
  origin: string;
  baseUrl: string;
}> {
  const backend = createBackend(options);
  const port = await listenLoopback(backend, 0);
  const origin = `http://127.0.0.1:${port}`;
  return { backend, port, origin, baseUrl: origin };
}

export function listenLoopback(backend: Backend, port = 0): Promise<number> {
  return new Promise((resolve, reject) => {
    const onError = (err: Error): void => {
      reject(err);
    };
    backend.server.once("error", onError);
    backend.server.listen(port, LISTEN_HOST, () => {
      backend.server.off("error", onError);
      const address = backend.server.address();
      if (address === null || typeof address === "string") {
        reject(new Error("listen"));
        return;
      }
      backend.setPort(address.port);
      resolve(address.port);
    });
  });
}
