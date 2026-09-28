/**
 * 不启动用户的 ssh，也不连接用户的 Comfy。
 * spawn 和预检都是测试注入的。
 */
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createServer, type Server } from "node:http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { ChildProcess } from "node:child_process";
import { USER_FACING } from "@canvas/schema";
import { ASKPASS_SECRET_NAME } from "./askpassExe.ts";
import {
  SSH_EXE_PATH,
  buildSshForwardArgs,
  createComfyTunnel,
  parseSshComfyConfig,
  sshChildEnv,
  type SshSpawn,
} from "./comfyTunnel.ts";
import type { SecretPlatform } from "../secrets/types.ts";

const PASSWORD = "unit-ssh-secret-value";
const KEY = "-----BEGIN OPENSSH PRIVATE KEY-----\nunit-key-body\n-----END OPENSSH PRIVATE KEY-----\n";

function memoryPlatform(): SecretPlatform {
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
      return Uint8Array.from(plain);
    },
    unprotectData(cipher) {
      return Uint8Array.from(cipher);
    },
  };
}

function fakeProcess(onKill?: () => void): ChildProcess {
  const events = new EventEmitter();
  let exitCode: number | null = null;
  let killed = false;
  Object.defineProperties(events, {
    exitCode: {
      configurable: true,
      enumerable: true,
      get: () => exitCode,
      set: (value: number | null) => {
        exitCode = value;
      },
    },
    killed: {
      configurable: true,
      enumerable: true,
      get: () => killed,
      set: (value: boolean) => {
        killed = value;
      },
    },
    kill: {
      configurable: true,
      value: () => {
        onKill?.();
        killed = true;
        exitCode = 0;
        events.emit("exit", 0, null);
        return true;
      },
    },
  });
  return events as unknown as ChildProcess;
}

test("host 拒空、空格、:// 和减号开头；端口只收 1–65535；用户名拒换行", () => {
  assert.equal(parseSshComfyConfig({ host: "", port: 22, username: "root", remoteComfyPort: 8188 }).ok, false);
  assert.equal(parseSshComfyConfig({ host: "bad host", port: 22, username: "root", remoteComfyPort: 8188 }).ok, false);
  assert.equal(parseSshComfyConfig({ host: "http://example", port: 22, username: "root", remoteComfyPort: 8188 }).ok, false);
  assert.equal(parseSshComfyConfig({ host: "-oProxyCommand", port: 22, username: "root", remoteComfyPort: 8188 }).ok, false);
  assert.equal(parseSshComfyConfig({ host: "example", port: 0, username: "root", remoteComfyPort: 8188 }).ok, false);
  assert.equal(parseSshComfyConfig({ host: "example", port: 65536, username: "root", remoteComfyPort: 8188 }).ok, false);
  assert.equal(parseSshComfyConfig({ host: "example", port: 22, username: "ro\not", remoteComfyPort: 8188 }).ok, false);
  assert.equal(parseSshComfyConfig({ host: "example", port: 22, username: "root", remoteComfyPort: 1.5 }).ok, false);
  const ok = parseSshComfyConfig({ host: "example", port: 22, username: "root", remoteComfyPort: 8188 });
  assert.equal(ok.ok, true);
});

test("参数数组把用户@主机放在 -- 之后，转发只绑 127.0.0.1，密码不进环境", () => {
  const args = buildSshForwardArgs({
    sshPort: 22,
    localPort: 40000,
    remotePort: 8188,
    username: "root",
    host: "example",
    knownHostsPath: "C:\\data\\ssh-comfy.known_hosts",
  });
  const dash = args.indexOf("--");
  assert.equal(dash >= 0, true);
  assert.equal(args[dash + 1], "root@example");
  assert.equal(args.includes("-N"), true);
  assert.equal(args.includes("127.0.0.1:40000:127.0.0.1:8188"), true);
  assert.equal(args.includes("StrictHostKeyChecking=accept-new"), true);
  assert.equal(args.some((arg) => arg.includes("UserKnownHostsFile=")), true);
  assert.equal(args.join(" ").includes("0.0.0.0"), false);
  assert.equal(args.join(" ").includes(PASSWORD), false);
  const env = sshChildEnv({ SSH_ASKPASS: "stale", OTHER: "1" }, "C:\\data\\ssh-run\\askpass.exe");
  assert.equal(env.SSH_ASKPASS, "C:\\data\\ssh-run\\askpass.exe");
  assert.equal(env.SSH_ASKPASS_REQUIRE, "force");
  assert.equal(Object.values(env).join(" ").includes(PASSWORD), false);
});

test("没有 ssh.exe 时说明需要 OpenSSH 客户端，且不启动进程", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ssh-tunnel-missing-"));
  let spawned = 0;
  const tunnel = createComfyTunnel({
    dataDir: dir,
    platform: memoryPlatform(),
    restrictFile: async () => {},
    sshAvailable: () => false,
    spawnSsh: () => {
      spawned += 1;
      return fakeProcess();
    },
  });
  try {
    const saved = await tunnel.save({
      host: "example",
      port: 22,
      username: "root",
      remoteComfyPort: 8188,
      secret: PASSWORD,
    });
    assert.equal(saved.ok, true);
    const connected = await tunnel.connect();
    assert.equal(connected.ok, false);
    if (!connected.ok) {
      assert.equal(connected.message, USER_FACING.opensshClientRequired);
      assert.equal(connected.message, "需要系统可选功能「OpenSSH 客户端」。");
    }
    assert.equal(spawned, 0);
    assert.equal(SSH_EXE_PATH, "C:\\Windows\\System32\\OpenSSH\\ssh.exe");
  } finally {
    await tunnel.shutdown();
    await rm(dir, { recursive: true, force: true });
  }
});

test("启动时清掉残留口令文件；预检不是 2xx 就关掉隧道且不保留口令", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ssh-tunnel-probe-"));
  const runtime = join(dir, "ssh-run");
  const secretPath = join(runtime, ASKPASS_SECRET_NAME);
  await writeFile(secretPath, "leftover-secret", { flag: "w" }).catch(async () => {
    const { mkdir } = await import("node:fs/promises");
    await mkdir(runtime, { recursive: true });
    await writeFile(secretPath, "leftover-secret");
  });
  assert.equal(existsSync(secretPath), true);
  const seen: Array<{ shell: boolean; args: readonly string[]; env: NodeJS.ProcessEnv }> = [];
  const servers: Server[] = [];
  const spawnSsh: SshSpawn = (_exe, args, options) => {
    seen.push({ shell: options.shell, args, env: options.env });
    const forward = String(args[args.indexOf("-L") + 1] ?? "");
    const local = Number(forward.split(":")[1]);
    const http = createServer((_req, res) => {
      res.writeHead(500);
      res.end();
    });
    servers.push(http);
    http.listen(local, "127.0.0.1");
    return fakeProcess(() => {
      http.close();
    });
  };
  const tunnel = createComfyTunnel({
    dataDir: dir,
    platform: memoryPlatform(),
    restrictFile: async () => {},
    sshAvailable: () => true,
    spawnSsh,
  });
  try {
    assert.equal(existsSync(secretPath), false);
    assert.equal((await tunnel.save({
      host: "example",
      port: 22,
      username: "root",
      remoteComfyPort: 8188,
      secret: PASSWORD,
    })).ok, true);
    const connected = await tunnel.connect();
    assert.equal(connected.ok, false);
    if (!connected.ok) {
      assert.equal(connected.message, USER_FACING.comfyUnreachable);
    }
    assert.equal(seen.length, 1);
    assert.equal(seen[0]?.shell, false);
    assert.equal(seen[0]?.args.join(" ").includes(PASSWORD), false);
    assert.equal(Object.values(seen[0]?.env ?? {}).join("\n").includes(PASSWORD), false);
    assert.equal(String(seen[0]?.env.SSH_ASKPASS ?? "").endsWith("askpass.exe"), true);
    assert.equal(existsSync(secretPath), false);
    const state = await tunnel.publicState();
    assert.equal(state.configured, true);
    if (state.configured) {
      assert.equal(state.connected, false);
      assert.equal("localPort" in state, false);
    }
  } finally {
    for (const http of servers) {
      http.close();
    }
    await tunnel.shutdown();
    await rm(dir, { recursive: true, force: true });
  }
});

test("预检 200 后保持转发；断开删口令文件。私钥走 -i，不进 argv", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ssh-tunnel-ok-"));
  const seen: Array<{ args: readonly string[]; env: NodeJS.ProcessEnv; shell: false }> = [];
  const servers: Server[] = [];
  const spawnSsh: SshSpawn = (_exe, args, options) => {
    seen.push({ args, env: options.env, shell: options.shell });
    const forward = String(args[args.indexOf("-L") + 1] ?? "");
    const local = Number(forward.split(":")[1]);
    const http = createServer((req, res) => {
      if (req.url?.startsWith("/object_info")) {
        res.writeHead(200);
        res.end("{}");
        return;
      }
      res.writeHead(404);
      res.end();
    });
    servers.push(http);
    http.listen(local, "127.0.0.1");
    return fakeProcess(() => {
      http.close();
    });
  };
  const restricted: string[] = [];
  const tunnel = createComfyTunnel({
    dataDir: dir,
    platform: memoryPlatform(),
    restrictFile: async (path) => {
      restricted.push(path);
    },
    sshAvailable: () => true,
    spawnSsh,
  });
  try {
    assert.equal((await tunnel.save({
      host: "gpu.example",
      port: 22,
      username: "root",
      remoteComfyPort: 8188,
      secret: PASSWORD,
    })).ok, true);
    const connected = await tunnel.connect();
    assert.equal(connected.ok, true);
    if (connected.ok) {
      assert.equal(connected.localPort > 0, true);
    }
    const state = await tunnel.publicState();
    assert.equal(state.configured, true);
    if (state.configured) {
      assert.equal(state.connected, true);
      assert.equal(state.host, "gpu.example");
      assert.equal(typeof state.localPort, "number");
    }
    const secretPath = join(dir, "ssh-run", ASKPASS_SECRET_NAME);
    assert.equal(existsSync(secretPath), true);
    assert.equal(restricted.some((path) => path.endsWith(ASKPASS_SECRET_NAME)), true);
    await tunnel.disconnect();
    assert.equal(existsSync(secretPath), false);
    const after = await tunnel.publicState();
    if (after.configured) {
      assert.equal(after.connected, false);
    }

    assert.equal((await tunnel.save({
      host: "gpu.example",
      port: 22,
      username: "root",
      remoteComfyPort: 8188,
      secret: KEY,
    })).ok, true);
    const keyed = await tunnel.connect();
    assert.equal(keyed.ok, true);
    const keyArgs = seen[seen.length - 1]?.args.join("\n") ?? "";
    assert.equal(keyArgs.includes("-i"), true);
    assert.equal(keyArgs.includes("unit-key-body"), false);
    assert.equal(keyArgs.includes("BEGIN OPENSSH PRIVATE KEY"), false);
    assert.equal(seen[seen.length - 1]?.env.SSH_ASKPASS, undefined);
    const forwarded = seen[0]?.args.join(" ") ?? "";
    assert.equal(forwarded.includes("127.0.0.1:"), true);
    assert.equal(forwarded.includes(":127.0.0.1:8188"), true);
    assert.equal(forwarded.includes("0.0.0.0"), false);
    const dash = seen[0]?.args.indexOf("--") ?? -1;
    assert.equal(seen[0]?.args[dash + 1], "root@gpu.example");
  } finally {
    for (const http of servers) {
      http.close();
    }
    await tunnel.shutdown();
    await rm(dir, { recursive: true, force: true });
  }
});
