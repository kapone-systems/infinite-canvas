import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  AppDataError,
  DEFAULT_LISTEN_PORT,
  ensureAppDataLayout,
  parseListenPort,
  parseServeWeb,
  readAppJson,
  resolveAppDataDir,
} from "./appData.ts";
import { probeComfyHttp, realComfyReachability, type ComfyReachability } from "./execution/comfy/client.ts";
import { createFixtureVideoAdapter, createNeedsSecretAdapter } from "./execution/adapters/exampleVideoFixture.ts";
import { FakeExecutor, parseFakeExecutor } from "./execution/fakeExecutor.ts";
import { argvRequestsFakeExecutor, readUseLocalComfySync } from "./execution/useLocalComfy.ts";
import { probeFfmpegFfprobe } from "./ffmpegStatus.ts";
import { createBackend, listenLoopback } from "./http/createServer.ts";
import { createPlatformSecretStore } from "./secrets/platformSecretStore.ts";
import { restrictSecretFile } from "./secrets/restrictFile.ts";
import { createWindowsSecretPlatform } from "./secrets/windowsPlatform.ts";
import { createComfyTunnel, systemSshAvailable } from "./ssh/comfyTunnel.ts";
import { defaultWebRoot } from "./http/staticFiles.ts";
import { acquireBackendLock, type LockHandle } from "./lock.ts";
import { BACKEND_MESSAGES, portOccupiedMessage } from "./messages.ts";
import { generateSessionToken, publicUrlWithFragmentToken, writeSessionToken } from "./token.ts";

function webRootHasIndex(dir: string): boolean {
  return existsSync(join(dir, "index.html"));
}

/**
 * 方案第 6 节：`--serve-web` 出静态页。
 * 终端打印的是后端端口地址，所以默认 dist 若已构建也要能打开「还没有工程」。
 */
export function resolveWebRoot(argv: string[]): { ok: true; root: string | undefined } | { ok: false; message: string } {
  const parsed = parseServeWeb(argv);
  const fallback = defaultWebRoot();
  const chosen = parsed.root !== undefined ? resolve(parsed.root) : fallback;
  if (parsed.enabled) {
    if (!webRootHasIndex(chosen)) {
      return { ok: false, message: BACKEND_MESSAGES.webRootMissing };
    }
    return { ok: true, root: chosen };
  }
  if (webRootHasIndex(chosen)) {
    return { ok: true, root: chosen };
  }
  return { ok: true, root: undefined };
}

function processReachability(argv: string[], env: NodeJS.ProcessEnv): ComfyReachability {
  if (argv.includes("--fake-comfy-reachable") || env.CANVAS_FAKE_COMFY_REACHABLE === "1") {
    return {
      probe: async () => ({ reachable: true, message: "" }),
    };
  }
  return realComfyReachability;
}

function launchedDirectly(): boolean {
  const entry = process.argv[1];
  if (entry === undefined) {
    return false;
  }
  try {
    return pathToFileURL(resolve(entry)).href.toLowerCase() === import.meta.url.toLowerCase();
  } catch {
    return false;
  }
}

function isErrno(err: unknown, code: string): boolean {
  return typeof err === "object" && err !== null && "code" in err && (err as { code: unknown }).code === code;
}

export async function runBackend(
  argv: string[] = process.argv.slice(2),
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  let dataDir: string;
  try {
    dataDir = resolveAppDataDir({ argv, env });
  } catch (err) {
    const message = err instanceof AppDataError ? err.message : BACKEND_MESSAGES.missingLocalAppData;
    console.error(message);
    process.exitCode = 1;
    return;
  }

  await ensureAppDataLayout(dataDir);

  const locked = acquireBackendLock(dataDir);
  if (!locked.ok) {
    console.error(locked.message);
    process.exitCode = 1;
    return;
  }
  const lock: LockHandle = locked.lock;

  const releaseAndExit = (code: number): void => {
    lock.release();
    process.exit(code);
  };

  let shutdownStarted = false;
  const shutdown = (backendClose: () => Promise<void>): void => {
    if (shutdownStarted) {
      return;
    }
    shutdownStarted = true;
    void backendClose()
      .catch(() => undefined)
      .finally(() => {
        lock.release();
        process.exit(0);
      });
  };

  try {
    const appJson = await readAppJson(dataDir);
    let port = DEFAULT_LISTEN_PORT;
    try {
      port = parseListenPort(argv, env, appJson);
    } catch (err) {
      const message = err instanceof AppDataError ? err.message : BACKEND_MESSAGES.invalidListenPort;
      console.error(message);
      releaseAndExit(1);
      return;
    }

    const token = generateSessionToken();

    const webRootResult = resolveWebRoot(argv);
    if (!webRootResult.ok) {
      console.error(webRootResult.message);
      releaseAndExit(1);
      return;
    }

    const ffmpeg = await probeFfmpegFfprobe({
      ffmpegPath: appJson.ffmpegPath,
      ffprobePath: appJson.ffprobePath,
    });

    const fakeExecutor = new FakeExecutor(parseFakeExecutor(argv, env));
    const sshPlatform = createWindowsSecretPlatform();
    const sshTunnel = createComfyTunnel({
      dataDir,
      platform: sshPlatform,
      restrictFile: restrictSecretFile,
      sshAvailable: () => systemSshAvailable(),
      probe: probeComfyHttp,
    });
    const backend = createBackend({
      token,
      dataDir,
      ffmpeg,
      listenPort: port,
      webRoot: webRootResult.root,
      accessLog: (line) => {
        console.log(line);
      },
      executor: fakeExecutor,
      fallbackExecutor: fakeExecutor,
      allowRealComfy: !argvRequestsFakeExecutor(argv),
      useLocalComfy: readUseLocalComfySync(dataDir),
      comfyReachability: processReachability(argv, env),
      comfyBaseUrl: appJson.comfyBaseUrl ?? null,
      cloudAdapters: argv.includes("--fixture-hang")
        ? [createFixtureVideoAdapter({ hangPoll: true }), createNeedsSecretAdapter()]
        : undefined,
      secretStore: createPlatformSecretStore({
        platform: sshPlatform,
        secretsDir: join(dataDir, "secrets"),
        restrictFile: restrictSecretFile,
      }),
      sshTunnel,
    });

    try {
      const bound = await listenLoopback(backend, port);
      // 监听成功后再写令牌。绑定失败（端口被占）不得换掉已经在跑的那份 session.token。
      await writeSessionToken(dataDir, token);
      process.on("SIGINT", () => {
        shutdown(() => backend.close());
      });
      process.on("SIGTERM", () => {
        shutdown(() => backend.close());
      });
      // 桌面壳关窗只走 IPC。不要靠 SIGINT/SIGTERM，Windows 上那两条到不了 flushAutosave。
      process.on("message", (message: unknown) => {
        if (message === "shutdown") {
          shutdown(() => backend.close());
        }
      });
      console.log(publicUrlWithFragmentToken(bound, token, webRootResult.root !== undefined));
    } catch (err) {
      if (isErrno(err, "EADDRINUSE")) {
        console.error(portOccupiedMessage(port));
        await backend.close().catch(() => undefined);
        releaseAndExit(1);
        return;
      }
      throw err;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : BACKEND_MESSAGES.requestFailed;
    console.error(message);
    releaseAndExit(1);
  }
}

if (launchedDirectly()) {
  void runBackend();
}
