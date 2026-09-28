/**
 * 只启动 C:\Windows\System32\OpenSSH\ssh.exe。
 * 参数数组、shell: false。密码不进 argv，也不进 ssh 的环境变量。
 * 本机转发只绑 127.0.0.1。连上后用 probeComfyHttp 打转发端口，不用 runtime.probeComfy。
 */
import { type ChildProcess, spawn } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer as createNetServer } from "node:net";
import { connect as connectNet } from "node:net";
import { join } from "node:path";
import { USER_FACING } from "@canvas/schema";
import { BACKEND_MESSAGES } from "../messages.ts";
import { probeComfyHttp, type ComfyProbeResult } from "../execution/comfy/client.ts";
import {
  deleteSshComfySecretSync,
  readSshComfySecretSync,
  saveSshComfySecret,
} from "../secrets/sshComfySecret.ts";
import { SecretStoreRejectedError } from "../secrets/secretRef.ts";
import type { SecretPlatform } from "../secrets/types.ts";
import { ASKPASS_SECRET_NAME, installAskpassExe } from "./askpassExe.ts";

export const SSH_EXE_PATH = "C:\\Windows\\System32\\OpenSSH\\ssh.exe";
export const SSH_COMFY_CONFIG_FILENAME = "ssh-comfy.json";
export const SSH_USERNAME_MAX = 64;
export const SSH_HOST_MAX = 253;
export const SSH_SECRET_MAX_BYTES = 512 * 1024;

const RUNTIME_DIR = "ssh-run";
const IDENTITY_NAME = "identity";
const KNOWN_HOSTS_NAME = "ssh-comfy.known_hosts";
const READY_TIMEOUT_MS = 8000;

export type SshComfyConfig = {
  host: string;
  port: number;
  username: string;
  remoteComfyPort: number;
};

export type SshComfyPublic =
  | { configured: false }
  | (SshComfyConfig & { configured: true; connected: boolean; localPort?: number });

export type SshSpawnOptions = {
  shell: false;
  windowsHide: true;
  stdio: ["ignore", "ignore", "ignore"];
  env: NodeJS.ProcessEnv;
};

export type SshSpawn = (exe: string, args: readonly string[], options: SshSpawnOptions) => ChildProcess;

export function systemSshAvailable(sshExe: string = SSH_EXE_PATH): boolean {
  return existsSync(sshExe);
}

export function spawnSystemSsh(exe: string, args: readonly string[], options: SshSpawnOptions): ChildProcess {
  return spawn(exe, [...args], options);
}

function isIntegerPort(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 65535;
}

export function parseSshComfyConfig(input: {
  host: unknown;
  port: unknown;
  username: unknown;
  remoteComfyPort: unknown;
}): { ok: true; config: SshComfyConfig } | { ok: false } {
  if (typeof input.host !== "string" || typeof input.username !== "string") {
    return { ok: false };
  }
  const host = input.host;
  if (host.length === 0 || host.length > SSH_HOST_MAX) {
    return { ok: false };
  }
  if (/\s/.test(host) || host.includes("://") || host.startsWith("-") || host.includes("@")) {
    return { ok: false };
  }
  const username = input.username;
  if (username.length === 0 || username.length > SSH_USERNAME_MAX) {
    return { ok: false };
  }
  if (/[\r\n\0]/.test(username) || username.includes("@") || /\s/.test(username)) {
    return { ok: false };
  }
  if (!isIntegerPort(input.port) || !isIntegerPort(input.remoteComfyPort)) {
    return { ok: false };
  }
  return {
    ok: true,
    config: {
      host,
      port: input.port,
      username,
      remoteComfyPort: input.remoteComfyPort,
    },
  };
}

export function isOpenSshPrivateKey(secret: string): boolean {
  const text = secret.replace(/^\uFEFF/, "").trimStart();
  return text.startsWith("-----BEGIN ") && text.includes("PRIVATE KEY-----");
}

export function buildSshForwardArgs(input: {
  sshPort: number;
  localPort: number;
  remotePort: number;
  username: string;
  host: string;
  knownHostsPath: string;
  identityPath?: string;
}): string[] {
  const known = input.knownHostsPath.replace(/"/g, "");
  const args = [
    "-N",
    "-L",
    `127.0.0.1:${input.localPort}:127.0.0.1:${input.remotePort}`,
    "-p",
    String(input.sshPort),
    "-o",
    "StrictHostKeyChecking=accept-new",
    "-o",
    `UserKnownHostsFile="${known}"`,
    "-o",
    "ExitOnForwardFailure=yes",
  ];
  if (input.identityPath !== undefined) {
    args.push("-i", input.identityPath, "-o", "IdentitiesOnly=yes", "-o", "PreferredAuthentications=publickey");
  } else {
    args.push("-o", "PreferredAuthentications=password", "-o", "NumberOfPasswordPrompts=1");
  }
  args.push("--", `${input.username}@${input.host}`);
  return args;
}

/** 密码不放进返回的环境。askpassPath 只是助手 exe 的路径。 */
export function sshChildEnv(base: NodeJS.ProcessEnv, askpassPath: string | null): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...base };
  delete env.SSH_ASKPASS;
  delete env.SSH_ASKPASS_REQUIRE;
  if (askpassPath !== null) {
    env.SSH_ASKPASS = askpassPath;
    env.SSH_ASKPASS_REQUIRE = "force";
  }
  return env;
}

function configPath(dataDir: string): string {
  return join(dataDir, SSH_COMFY_CONFIG_FILENAME);
}

function runtimeDir(dataDir: string): string {
  return join(dataDir, RUNTIME_DIR);
}

async function readConfig(dataDir: string): Promise<SshComfyConfig | null> {
  try {
    const raw = JSON.parse(await readFile(configPath(dataDir), "utf8")) as unknown;
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
      return null;
    }
    const record = raw as Record<string, unknown>;
    const parsed = parseSshComfyConfig({
      host: record.host,
      port: record.port,
      username: record.username,
      remoteComfyPort: record.remoteComfyPort,
    });
    return parsed.ok ? parsed.config : null;
  } catch {
    return null;
  }
}

async function writeConfig(dataDir: string, config: SshComfyConfig): Promise<void> {
  await mkdir(dataDir, { recursive: true });
  const body = `${JSON.stringify(
    {
      host: config.host,
      port: config.port,
      username: config.username,
      remoteComfyPort: config.remoteComfyPort,
    },
    null,
    2,
  )}\n`;
  await writeFile(configPath(dataDir), body, "utf8");
}

export function reserveLoopbackPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createNetServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = address !== null && typeof address !== "string" ? address.port : 0;
      server.close((err) => {
        if (err) {
          reject(err);
          return;
        }
        if (port <= 0) {
          reject(new Error("port"));
          return;
        }
        resolve(port);
      });
    });
  });
}

function portAccepts(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connectNet({ host: "127.0.0.1", port });
    let settled = false;
    const finish = (ok: boolean): void => {
      if (settled) {
        return;
      }
      settled = true;
      socket.destroy();
      resolve(ok);
    };
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
    socket.setTimeout(200, () => finish(false));
  });
}

async function waitUntilForwardReady(port: number, child: ChildProcess, timeoutMs: number): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (child.exitCode !== null || child.killed) {
      return false;
    }
    if (await portAccepts(port)) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  return child.exitCode === null && !child.killed && (await portAccepts(port));
}

export type ComfyTunnel = {
  publicState: () => Promise<SshComfyPublic>;
  save: (input: {
    host: unknown;
    port: unknown;
    username: unknown;
    remoteComfyPort: unknown;
    secret: unknown;
  }) => Promise<{ ok: true } | { ok: false; message: string }>;
  remove: () => Promise<{ ok: true } | { ok: false; message: string }>;
  connect: () => Promise<{ ok: true; localPort: number } | { ok: false; message: string }>;
  disconnect: () => Promise<void>;
  shutdown: () => Promise<void>;
};

export function createComfyTunnel(options: {
  dataDir: string;
  platform: SecretPlatform;
  restrictFile: (filePath: string) => Promise<void>;
  spawnSsh?: SshSpawn;
  sshExe?: string;
  sshAvailable?: () => boolean;
  probe?: (baseUrl: string) => Promise<ComfyProbeResult>;
  reservePort?: () => Promise<number>;
  env?: NodeJS.ProcessEnv;
  readyTimeoutMs?: number;
}): ComfyTunnel {
  const dataDir = options.dataDir;
  const spawnSsh = options.spawnSsh ?? spawnSystemSsh;
  const sshExe = options.sshExe ?? SSH_EXE_PATH;
  const sshAvailable = options.sshAvailable ?? (() => systemSshAvailable(sshExe));
  const probe = options.probe ?? probeComfyHttp;
  const reservePort = options.reservePort ?? reserveLoopbackPort;
  const baseEnv = options.env ?? process.env;
  const readyTimeoutMs = options.readyTimeoutMs ?? READY_TIMEOUT_MS;
  let active: ChildProcess | null = null;
  let localPort: number | null = null;
  let exitHook: (() => void) | null = null;

  const secretFile = join(runtimeDir(dataDir), ASKPASS_SECRET_NAME);
  const identityFile = join(runtimeDir(dataDir), IDENTITY_NAME);

  function sweepRuntimeSecrets(): void {
    rmSync(secretFile, { force: true });
    rmSync(identityFile, { force: true });
  }

  sweepRuntimeSecrets();

  function unhookExit(): void {
    if (exitHook !== null) {
      process.off("exit", exitHook);
      exitHook = null;
    }
  }

  function clearChild(): void {
    unhookExit();
    active = null;
    localPort = null;
  }

  async function stopChild(): Promise<void> {
    const child = active;
    clearChild();
    if (child !== null && child.exitCode === null && !child.killed) {
      try {
        child.kill();
      } catch {
        // 进程已经没了。
      }
    }
    sweepRuntimeSecrets();
  }

  function watch(child: ChildProcess): void {
    const onProcessExit = (): void => {
      if (child.exitCode === null && !child.killed) {
        try {
          child.kill();
        } catch {
          // 退出途中杀不掉就留下，下次启动再清口令文件。
        }
      }
    };
    exitHook = onProcessExit;
    process.on("exit", onProcessExit);
    child.once("exit", () => {
      if (active === child) {
        clearChild();
        sweepRuntimeSecrets();
      }
    });
  }

  async function publicState(): Promise<SshComfyPublic> {
    const config = await readConfig(dataDir);
    if (config === null) {
      return { configured: false };
    }
    const connected = active !== null && active.exitCode === null && !active.killed && localPort !== null;
    if (connected && localPort !== null) {
      return { configured: true, ...config, connected: true, localPort };
    }
    return { configured: true, ...config, connected: false };
  }

  async function save(input: {
    host: unknown;
    port: unknown;
    username: unknown;
    remoteComfyPort: unknown;
    secret: unknown;
  }): Promise<{ ok: true } | { ok: false; message: string }> {
    const parsed = parseSshComfyConfig(input);
    if (!parsed.ok || typeof input.secret !== "string" || input.secret.length === 0) {
      return { ok: false, message: BACKEND_MESSAGES.requestFailed };
    }
    const bytes = Buffer.from(input.secret, "utf8");
    if (bytes.byteLength > SSH_SECRET_MAX_BYTES) {
      return { ok: false, message: BACKEND_MESSAGES.requestFailed };
    }
    try {
      await saveSshComfySecret({
        dataDir,
        platform: options.platform,
        restrictFile: options.restrictFile,
        secret: new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength),
      });
      await writeConfig(dataDir, parsed.config);
    } catch (err) {
      if (err instanceof SecretStoreRejectedError) {
        return { ok: false, message: err.message };
      }
      return { ok: false, message: BACKEND_MESSAGES.requestFailed };
    }
    return { ok: true };
  }

  async function remove(): Promise<{ ok: true } | { ok: false; message: string }> {
    await stopChild();
    try {
      deleteSshComfySecretSync(dataDir, options.platform);
      await rm(configPath(dataDir), { force: true });
    } catch (err) {
      if (err instanceof SecretStoreRejectedError) {
        return { ok: false, message: err.message };
      }
      return { ok: false, message: BACKEND_MESSAGES.requestFailed };
    }
    return { ok: true };
  }

  async function connect(): Promise<{ ok: true; localPort: number } | { ok: false; message: string }> {
    const config = await readConfig(dataDir);
    const secretBytes = readSshComfySecretSync(dataDir, options.platform);
    if (config === null || secretBytes === null || secretBytes.byteLength === 0) {
      return { ok: false, message: BACKEND_MESSAGES.requestFailed };
    }
    if (!sshAvailable()) {
      return { ok: false, message: USER_FACING.opensshClientRequired };
    }
    await stopChild();
    const secret = Buffer.from(secretBytes).toString("utf8");
    const useKey = isOpenSshPrivateKey(secret);
    let child: ChildProcess | null = null;
    try {
      await mkdir(runtimeDir(dataDir), { recursive: true });
      const knownHosts = join(dataDir, KNOWN_HOSTS_NAME);
      let identityPath: string | undefined;
      let askpassPath: string | null = null;
      if (useKey) {
        const text = secret.endsWith("\n") ? secret : `${secret}\n`;
        await writeFile(identityFile, text, { encoding: "utf8", mode: 0o600 });
        await options.restrictFile(identityFile);
        identityPath = identityFile;
      } else {
        askpassPath = await installAskpassExe(runtimeDir(dataDir));
        await writeFile(secretFile, secretBytes, { mode: 0o600 });
        await options.restrictFile(secretFile);
      }
      const port = await reservePort();
      const args = buildSshForwardArgs({
        sshPort: config.port,
        localPort: port,
        remotePort: config.remoteComfyPort,
        username: config.username,
        host: config.host,
        knownHostsPath: knownHosts,
        identityPath,
      });
      child = spawnSsh(sshExe, args, {
        shell: false,
        windowsHide: true,
        stdio: ["ignore", "ignore", "ignore"],
        env: sshChildEnv(baseEnv, askpassPath),
      });
      active = child;
      watch(child);
      const ready = await waitUntilForwardReady(port, child, readyTimeoutMs);
      if (!ready || active !== child) {
        await stopChild();
        return { ok: false, message: USER_FACING.comfyUnreachable };
      }
      const probed = await probe(`http://127.0.0.1:${port}`);
      if (!probed.reachable || active !== child) {
        await stopChild();
        return { ok: false, message: USER_FACING.comfyUnreachable };
      }
      localPort = port;
      return { ok: true, localPort: port };
    } catch {
      await stopChild();
      return { ok: false, message: USER_FACING.comfyUnreachable };
    }
  }

  return {
    publicState,
    save,
    remove,
    connect,
    disconnect: stopChild,
    shutdown: stopChild,
  };
}
