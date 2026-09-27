import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import { appendFile } from "node:fs/promises";
import { join, resolve } from "node:path";

/**
 * 系统 Node。本次是 v24.19.0。
 * Electron 28 带上 ELECTRON_RUN_AS_NODE 时会拒绝 --experimental-strip-types，也没有 node:sqlite。
 * 父进程路径即使以 electron.exe 结尾，也不拿窗口进程自己的可执行文件当后端。
 */
export const backendNodeBin = "C:\\Program Files\\nodejs\\node.exe";

export const DEFAULT_LISTEN_PORT = 8787;

/** 与 apps/backend/src/messages.ts 的 lockHeld、webRootMissing 一致。 */
export const LOCK_HELD_LINE = "画布后端已经在运行。";
export const WEB_ROOT_MISSING_LINE =
  "找不到可演示的界面文件。请先构建前端，或用 --serve-web 指定含 index.html 的目录。";

const PORT_OCCUPIED_LINE =
  /^端口 (\d+) 已被占用。如果画布后端已经在运行，请打开原来的地址；否则换一个端口再启动。$/;

const FRAGMENT_URL = /^http:\/\/127\.0\.0\.1:(\d+)\/#token=(\S+)$/;

export const windowWebPreferences = {
  contextIsolation: true,
  nodeIntegration: false,
  nodeIntegrationInWorker: false,
  nodeIntegrationInSubFrames: false,
  sandbox: true,
} as const;

export const windowChrome = {
  frame: true,
  width: 1440,
  height: 960,
} as const;

export type BackendSpawnSpec = {
  command: string;
  args: readonly string[];
  cwd: string;
  shell: false;
  stdio: readonly ["ignore", "pipe", "pipe", "ipc"];
};

/** apps/desktop/src 与编译后的 apps/desktop/dist 都是仓库根下三级。 */
export function repoRootFromDesktopModule(moduleDir: string): string {
  return resolve(moduleDir, "../../..");
}

export function backendScriptPath(repoRoot: string): string {
  return resolve(repoRoot, "apps", "backend", "src", "main.ts");
}

export function backendSpawnSpec(
  repoRoot: string,
  env: NodeJS.ProcessEnv = {},
  nodeBin: string = backendNodeBin,
): BackendSpawnSpec {
  const root = resolve(repoRoot);
  const args = ["--experimental-strip-types", backendScriptPath(root)];
  if (env.CANVAS_SHELL_DEV !== "1") {
    args.push("--serve-web");
  }
  return {
    command: nodeBin,
    args,
    cwd: root,
    shell: false,
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  };
}

/** 子进程环境不得带上 ELECTRON_RUN_AS_NODE。 */
export function childEnv(parent: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...parent };
  delete env.ELECTRON_RUN_AS_NODE;
  return env;
}

export function packagedCanvasRoot(resourcesPath: string): string {
  return join(resourcesPath, "canvas");
}

export function packagedNodeBin(resourcesPath: string): string {
  return join(resourcesPath, "node", "node.exe");
}

export function spawnBackend(
  repoRoot: string,
  env: NodeJS.ProcessEnv,
  nodeBin: string = backendNodeBin,
): ChildProcess {
  const spec = backendSpawnSpec(repoRoot, env, nodeBin);
  return spawn(spec.command, [...spec.args], {
    cwd: spec.cwd,
    env: childEnv(env),
    shell: spec.shell,
    windowsHide: true,
    stdio: [spec.stdio[0], spec.stdio[1], spec.stdio[2], spec.stdio[3]],
  });
}

export type FragmentAddress = {
  url: string;
  port: number;
  token: string;
};

/** 开发测量时，同一把片段令牌改由 Vite 5173 打开，后端仍只听 127.0.0.1。 */
export function devShellPageUrl(url: string): string | null {
  const parsed = parseFragmentAddress(url);
  if (parsed === null) {
    return null;
  }
  return parseFragmentAddress(`http://127.0.0.1:5173/#token=${parsed.token}`)?.url ?? null;
}
export function parseFragmentAddress(line: string): FragmentAddress | null {
  const trimmed = line.trim();
  if (trimmed.includes("?") || trimmed.startsWith("file:")) {
    return null;
  }
  const match = FRAGMENT_URL.exec(trimmed);
  if (match === null) {
    return null;
  }
  const port = Number(match[1]);
  const token = match[2];
  if (!Number.isInteger(port) || port < 1 || port > 65535 || token === undefined || token.length === 0) {
    return null;
  }
  return { url: match[0], port, token };
}

export function pageUrlFromStdout(stdout: string): string | null {
  for (const line of stdout.split(/\r?\n/)) {
    const parsed = parseFragmentAddress(line);
    if (parsed !== null) {
      return parsed.url;
    }
  }
  return null;
}

export function consumeLines(pending: string, chunk: string): { lines: string[]; pending: string } {
  const text = pending + chunk;
  const parts = text.split(/\r?\n/);
  const rest = parts.pop() ?? "";
  return { lines: parts, pending: rest };
}

export function occupiedPort(stderr: string): number | null {
  for (const line of stderr.split(/\r?\n/)) {
    const match = PORT_OCCUPIED_LINE.exec(line.trim());
    if (match !== null && match[1] !== undefined) {
      return Number(match[1]);
    }
  }
  return null;
}

export function userFacingStderr(stderr: string): string[] {
  const out: string[] = [];
  for (const line of stderr.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length === 0) {
      continue;
    }
    if (trimmed === LOCK_HELD_LINE || trimmed === WEB_ROOT_MISSING_LINE || PORT_OCCUPIED_LINE.test(trimmed)) {
      out.push(trimmed);
    }
  }
  return out;
}

export function shouldAttachExisting(stderr: string): boolean {
  return stderr.includes(LOCK_HELD_LINE) || occupiedPort(stderr) !== null;
}

export function shellLogDirectory(env: NodeJS.ProcessEnv): string {
  const override = env.CANVAS_SHELL_LOG_DIR;
  if (override !== undefined && override.length > 0) {
    return resolve(override);
  }
  const local = env.LOCALAPPDATA;
  if (local === undefined || local.length === 0) {
    throw new Error("找不到 LOCALAPPDATA，无法写壳日志。");
  }
  return join(local, "CanvasApp", "logs");
}

/** 丢掉整行 #token=，以及任何含令牌或 test-key-not-real 的行。 */
export function redactShellLogLine(line: string, token: string | null): string | null {
  if (line.includes("#token=")) {
    return null;
  }
  if (line.includes("test-key-not-real")) {
    return null;
  }
  if (token !== null && token.length > 0 && line.includes(token)) {
    return null;
  }
  return line;
}

export async function appendShellLog(dir: string, line: string, token: string | null): Promise<void> {
  const kept = redactShellLogLine(line, token);
  if (kept === null) {
    return;
  }
  mkdirSync(dir, { recursive: true });
  await appendFile(join(dir, "shell.log"), `${kept.replace(/\r?\n$/, "")}\n`, "utf8");
}

export function listenPortFromAppJson(dataDir: string): number | null {
  try {
    const raw: unknown = JSON.parse(readFileSync(join(dataDir, "app.json"), "utf8"));
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
      return null;
    }
    const port = (raw as { listenPort?: unknown }).listenPort;
    if (typeof port === "number" && Number.isInteger(port) && port >= 1 && port <= 65535) {
      return port;
    }
  } catch {
    return null;
  }
  return null;
}

export function attachPort(stderr: string, dataDir: string): number {
  return occupiedPort(stderr) ?? listenPortFromAppJson(dataDir) ?? DEFAULT_LISTEN_PORT;
}

export function appDataDir(env: NodeJS.ProcessEnv): string | null {
  const fromEnv = env.CANVAS_APP_DATA_DIR;
  if (fromEnv !== undefined && fromEnv.length > 0) {
    return resolve(fromEnv);
  }
  const local = env.LOCALAPPDATA;
  if (local === undefined || local.length === 0) {
    return null;
  }
  return join(local, "CanvasApp");
}

/**
 * 已有实例的地址仍是片段令牌。只探测 127.0.0.1，不杀占用者。
 * 健康检查要像本后端的 /health（ok 与 ffmpeg 字段），避免附到别的程序上。
 */
export async function readExistingFragmentUrl(dataDir: string, port: number): Promise<string | null> {
  let token = "";
  try {
    token = readFileSync(join(dataDir, "session.token"), "utf8").trim();
  } catch {
    return null;
  }
  if (token.length === 0 || /\s/.test(token)) {
    return null;
  }
  let response: Response;
  try {
    response = await fetch(`http://127.0.0.1:${port}/health`, { redirect: "manual" });
  } catch {
    return null;
  }
  if (response.status !== 200) {
    return null;
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return null;
  }
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return null;
  }
  const record = body as { ok?: unknown; ffmpeg?: unknown };
  if (record.ok !== true || typeof record.ffmpeg !== "string") {
    return null;
  }
  const url = `http://127.0.0.1:${port}/#token=${token}`;
  return parseFragmentAddress(url)?.url ?? null;
}
