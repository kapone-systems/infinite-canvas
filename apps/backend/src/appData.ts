import { readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { BACKEND_MESSAGES } from "./messages.ts";

export const APP_FOLDER_NAME = "CanvasApp";
export const SESSION_TOKEN_FILE = "session.token";
export const LOCK_RELATIVE_PATH = join("locks", "backend.lock");
export const DEFAULT_LISTEN_PORT = 8787;
export const VITE_DEV_PORT = 5173;
export const LISTEN_HOST = "127.0.0.1" as const;

export type AppJson = {
  listenPort?: number;
  ffmpegPath?: string | null;
  ffprobePath?: string | null;
  /** 本机 ComfyUI 地址。不进工程。空或缺省表示未配置。 */
  comfyBaseUrl?: string | null;
  /** 单条 ffmpeg 最长毫秒。缺省 30 分钟。 */
  ffmpegMaxRunMs?: number;
};

export const APP_JSON_FILENAME = "app.json" as const;

function asAppJson(value: unknown): AppJson {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  const record = value as Record<string, unknown>;
  const next: AppJson = {};
  if (typeof record.listenPort === "number" && Number.isInteger(record.listenPort)) {
    next.listenPort = record.listenPort;
  }
  if (record.ffmpegPath === null || typeof record.ffmpegPath === "string") {
    next.ffmpegPath = record.ffmpegPath;
  }
  if (record.ffprobePath === null || typeof record.ffprobePath === "string") {
    next.ffprobePath = record.ffprobePath;
  }
  if (record.comfyBaseUrl === null || typeof record.comfyBaseUrl === "string") {
    next.comfyBaseUrl = record.comfyBaseUrl;
  }
  if (typeof record.ffmpegMaxRunMs === "number" && Number.isFinite(record.ffmpegMaxRunMs) && record.ffmpegMaxRunMs > 0) {
    next.ffmpegMaxRunMs = record.ffmpegMaxRunMs;
  }
  return next;
}

export function readAppJsonSync(dataDir: string): AppJson {
  try {
    return asAppJson(JSON.parse(readFileSync(join(dataDir, APP_JSON_FILENAME), "utf8")));
  } catch {
    return {};
  }
}

export async function readAppJson(dataDir: string): Promise<AppJson> {
  try {
    const raw = await readFile(join(dataDir, APP_JSON_FILENAME), "utf8");
    return asAppJson(JSON.parse(raw));
  } catch {
    return {};
  }
}

export async function writeAppJson(dataDir: string, patch: Partial<AppJson>): Promise<AppJson> {
  const current = await readAppJson(dataDir);
  const next: AppJson = { ...current, ...patch };
  await mkdir(dataDir, { recursive: true });
  await writeFile(join(dataDir, APP_JSON_FILENAME), `${JSON.stringify(next, null, 2)}\n`, "utf8");
  return next;
}

export type ResolveAppDataDirInput = {
  argv?: string[];
  env?: NodeJS.ProcessEnv;
};

export class AppDataError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "AppDataError";
  }
}

export type ServeWebFlag = {
  enabled: boolean;
  root: string | undefined;
};

/** `--serve-web`、`--serve-web <dir>`、`--serve-web=<dir>`。方案第 6 节演示切片。 */
export function parseServeWeb(argv: string[]): ServeWebFlag {
  const eqPrefix = "--serve-web=";
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === undefined) {
      continue;
    }
    if (arg === "--serve-web") {
      const value = argv[i + 1];
      if (value !== undefined && !value.startsWith("--")) {
        return { enabled: true, root: value };
      }
      return { enabled: true, root: undefined };
    }
    if (arg.startsWith(eqPrefix)) {
      const value = arg.slice(eqPrefix.length);
      return { enabled: true, root: value.length > 0 ? value : undefined };
    }
  }
  return { enabled: false, root: undefined };
}

export function parseFlag(argv: string[], name: string): string | undefined {
  const eqPrefix = `${name}=`;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === undefined) {
      continue;
    }
    if (arg === name) {
      const value = argv[i + 1];
      if (value !== undefined && !value.startsWith("--")) {
        return value;
      }
      return undefined;
    }
    if (arg.startsWith(eqPrefix)) {
      const value = arg.slice(eqPrefix.length);
      return value.length > 0 ? value : undefined;
    }
  }
  return undefined;
}

export function parseListenPort(
  argv: string[] = process.argv.slice(2),
  env: NodeJS.ProcessEnv = process.env,
  appJson: AppJson = {},
): number {
  const fromArg = parseFlag(argv, "--port");
  const fromEnv = env.CANVAS_LISTEN_PORT;
  const raw = fromArg ?? fromEnv ?? (appJson.listenPort !== undefined ? String(appJson.listenPort) : undefined);
  if (raw === undefined) {
    return DEFAULT_LISTEN_PORT;
  }
  const port = Number.parseInt(raw, 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new AppDataError("INVALID_PORT", BACKEND_MESSAGES.invalidListenPort);
  }
  return port;
}

/**
 * 应用数据目录。测试必须传入 --data-dir 或 CANVAS_APP_DATA_DIR，
 * 不要写到真实 %LOCALAPPDATA%\\CanvasApp。
 */
export function resolveAppDataDir(input: ResolveAppDataDirInput = {}): string {
  const argv = input.argv ?? process.argv.slice(2);
  const env = input.env ?? process.env;
  const fromArg = parseFlag(argv, "--data-dir");
  if (fromArg !== undefined && fromArg.length > 0) {
    return resolve(fromArg);
  }
  const fromEnv = env.CANVAS_APP_DATA_DIR;
  if (fromEnv !== undefined && fromEnv.length > 0) {
    return resolve(fromEnv);
  }
  const localAppData = env.LOCALAPPDATA;
  if (localAppData === undefined || localAppData.length === 0) {
    throw new AppDataError("MISSING_LOCALAPPDATA", BACKEND_MESSAGES.missingLocalAppData);
  }
  if (!isAbsolute(localAppData)) {
    throw new AppDataError("MISSING_LOCALAPPDATA", BACKEND_MESSAGES.missingLocalAppData);
  }
  return join(localAppData, APP_FOLDER_NAME);
}

export async function ensureAppDataLayout(dataDir: string): Promise<void> {
  await mkdir(dataDir, { recursive: true });
  await mkdir(join(dataDir, "locks"), { recursive: true });
  await mkdir(join(dataDir, "logs"), { recursive: true });
}
