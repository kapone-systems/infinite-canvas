/**
 * 浏览器仍只打本机后端。GET 不回显 secret。
 * 保存本机地址先解析，不通过就不断开隧道。
 */
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { USER_FACING } from "@canvas/schema";
import { FakeExecutor } from "../execution/fakeExecutor.ts";
import { startBackend, STUB_FFMPEG } from "./createServer.ts";
import { headers, startTestApp, stopTestApp, TEST_TOKEN } from "./testApp.ts";
import { createComfyTunnel, type ComfyTunnel, type SshComfyPublic, SSH_COMFY_CONFIG_FILENAME } from "../ssh/comfyTunnel.ts";

const SECRET = "unit-ssh-secret-value";

function idleTunnel(overrides: Partial<ComfyTunnel> = {}): ComfyTunnel & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async publicState(): Promise<SshComfyPublic> {
      return { configured: false };
    },
    async save() {
      calls.push("save");
      return { ok: true };
    },
    async remove() {
      calls.push("remove");
      return { ok: true };
    },
    async connect() {
      calls.push("connect");
      return { ok: true, localPort: 23456 };
    },
    async disconnect() {
      calls.push("disconnect");
    },
    async shutdown() {
      calls.push("shutdown");
    },
    ...overrides,
  };
}

test("GET 不回显 secret，配置不进 app.json", async () => {
  const logs: string[] = [];
  const root = await mkdtemp(join(tmpdir(), "ssh-http-get-"));
  const dataDir = join(root, "data");
  await mkdir(dataDir, { recursive: true });
  const creds = new Map<string, Uint8Array>();
  const tunnel = createComfyTunnel({
    dataDir,
    platform: {
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
    },
    restrictFile: async () => {},
    sshAvailable: () => false,
  });
  const started = await startBackend({
    token: TEST_TOKEN,
    dataDir,
    ffmpeg: STUB_FFMPEG,
    sshTunnel: tunnel,
    accessLog: (line) => {
      logs.push(line);
    },
  });
  try {
    const empty = await fetch(`${started.baseUrl}/api/app/ssh-comfy`, {
      headers: headers(started.origin),
    });
    assert.equal(empty.status, 200);
    assert.deepEqual(await empty.json(), { configured: false });
    const saved = await fetch(`${started.baseUrl}/api/app/ssh-comfy`, {
      method: "PUT",
      headers: headers(started.origin),
      body: JSON.stringify({
        host: "gpu.example",
        port: 22,
        username: "root",
        remoteComfyPort: 8188,
        secret: SECRET,
      }),
    });
    assert.equal(saved.status, 204);
    const again = await fetch(`${started.baseUrl}/api/app/ssh-comfy`, {
      headers: headers(started.origin),
    });
    const body = await again.json() as Record<string, unknown>;
    assert.equal(JSON.stringify(body).includes(SECRET), false);
    assert.equal(body.configured, true);
    assert.equal(body.host, "gpu.example");
    assert.equal(body.connected, false);
    const config = await readFile(join(dataDir, SSH_COMFY_CONFIG_FILENAME), "utf8");
    assert.equal(config.includes(SECRET), false);
    assert.equal(config.includes("gpu.example"), true);
    const appJson = await readFile(join(dataDir, "app.json"), "utf8").catch(() => "");
    assert.equal(appJson.includes(SECRET), false);
    assert.equal(appJson.includes("gpu.example"), false);
    assert.equal(logs.join("\n").includes(SECRET), false);
    const bad = await fetch(`${started.baseUrl}/api/app/ssh-comfy`, {
      method: "PUT",
      headers: headers(started.origin),
      body: JSON.stringify({
        host: "http://gpu.example",
        port: 22,
        username: "root",
        remoteComfyPort: 8188,
        secret: SECRET,
      }),
    });
    assert.equal(bad.status, 400);
  } finally {
    await started.backend.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("连上后基址是 http://127.0.0.1 端口；预检失败不改基址", async () => {
  const root = await mkdtemp(join(tmpdir(), "ssh-http-connect-"));
  const dataDir = join(root, "data");
  await mkdir(dataDir, { recursive: true });
  let current = "http://127.0.0.1:9";
  const failing = idleTunnel({
    async connect() {
      return { ok: false, message: USER_FACING.comfyUnreachable };
    },
  });
  const started = await startBackend({
    token: TEST_TOKEN,
    dataDir,
    ffmpeg: STUB_FFMPEG,
    sshTunnel: failing,
    comfyBaseUrl: current,
    executor: new FakeExecutor(),
  });
  try {
    const denied = await fetch(`${started.baseUrl}/api/app/ssh-comfy/connect`, {
      method: "POST",
      headers: headers(started.origin),
    });
    assert.equal(denied.status, 400);
    const deniedBody = await denied.json() as { message: string };
    assert.equal(deniedBody.message, USER_FACING.comfyUnreachable);
    assert.equal(started.backend.execution.getComfyBaseUrl(), current);
  } finally {
    await started.backend.close();
  }
  const okTunnel = idleTunnel();
  const startedOk = await startBackend({
    token: TEST_TOKEN,
    dataDir,
    ffmpeg: STUB_FFMPEG,
    sshTunnel: okTunnel,
    comfyBaseUrl: current,
    executor: new FakeExecutor(),
  });
  try {
    const connected = await fetch(`${startedOk.baseUrl}/api/app/ssh-comfy/connect`, {
      method: "POST",
      headers: headers(startedOk.origin),
    });
    assert.equal(connected.status, 204);
    const base = startedOk.backend.execution.getComfyBaseUrl();
    assert.equal(base, "http://127.0.0.1:23456");
    assert.equal(base?.includes("localhost"), false);
    assert.equal(base?.includes("::1"), false);
  } finally {
    await startedOk.backend.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("保存本机地址：解析失败不断开；通过之后才断开再写入", async () => {
  const root = await mkdtemp(join(tmpdir(), "ssh-http-save-"));
  const dataDir = join(root, "data");
  await mkdir(dataDir, { recursive: true });
  let seenAtDisconnect: string | null = "not-yet";
  let reads = (): string | null => null;
  const tunnel = idleTunnel({
    async disconnect() {
      seenAtDisconnect = reads();
      tunnel.calls.push("disconnect");
    },
  });
  const started = await startBackend({
    token: TEST_TOKEN,
    dataDir,
    ffmpeg: STUB_FFMPEG,
    sshTunnel: tunnel,
    comfyBaseUrl: "http://127.0.0.1:9",
    executor: new FakeExecutor(),
  });
  reads = () => started.backend.execution.getComfyBaseUrl();
  try {
    const bad = await fetch(`${started.baseUrl}/api/app/comfy-base-url`, {
      method: "PUT",
      headers: headers(started.origin),
      body: JSON.stringify({ comfyBaseUrl: "http://8.8.8.8:8188" }),
    });
    assert.equal(bad.status, 400);
    assert.equal(tunnel.calls.includes("disconnect"), false);
    assert.equal(started.backend.execution.getComfyBaseUrl(), "http://127.0.0.1:9");
    const good = await fetch(`${started.baseUrl}/api/app/comfy-base-url`, {
      method: "PUT",
      headers: headers(started.origin),
      body: JSON.stringify({ comfyBaseUrl: "http://127.0.0.1:8188" }),
    });
    assert.equal(good.status, 204);
    assert.equal(seenAtDisconnect, "http://127.0.0.1:9");
    assert.equal(started.backend.execution.getComfyBaseUrl(), "http://127.0.0.1:8188");
  } finally {
    await started.backend.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("使用本机 ComfyUI 写在单独文件；没有 --fake-executor 且开关打开才换真执行器", async () => {
  const fake = new FakeExecutor({ behavior: "succeed-immediately" });
  const app = await startTestApp({
    executor: fake,
    fallbackExecutor: fake,
    allowRealComfy: true,
    useLocalComfy: false,
    comfyBaseUrl: "http://127.0.0.1:8188",
  });
  try {
    assert.equal(app.backend.execution.usingRealComfy(), false);
    assert.equal(app.backend.execution.getUseLocalComfy(), false);
    const turned = await fetch(`${app.baseUrl}/api/app/use-local-comfy`, {
      method: "PUT",
      headers: headers(app.origin),
      body: JSON.stringify({ enabled: true }),
    });
    assert.equal(turned.status, 204);
    assert.equal(app.backend.execution.usingRealComfy(), true);
    const file = await readFile(join(app.dataDir, "use-local-comfy.json"), "utf8");
    assert.equal(file.includes("\"enabled\": true"), true);
    await writeFile(join(app.dataDir, "app.json"), `${JSON.stringify({ comfyBaseUrl: "http://127.0.0.1:8188" })}\n`);
    const saved = await fetch(`${app.baseUrl}/api/app/comfy-base-url`, {
      method: "PUT",
      headers: headers(app.origin),
      body: JSON.stringify({ comfyBaseUrl: "http://127.0.0.1:8188" }),
    });
    assert.equal(saved.status, 204);
    const appJson = await readFile(join(app.dataDir, "app.json"), "utf8");
    assert.equal(appJson.includes("useLocalComfy"), false);
    assert.equal(appJson.includes("use-local-comfy"), false);
    const still = await readFile(join(app.dataDir, "use-local-comfy.json"), "utf8");
    assert.equal(still.includes("\"enabled\": true"), true);
    const off = await fetch(`${app.baseUrl}/api/app/use-local-comfy`, {
      method: "PUT",
      headers: headers(app.origin),
      body: JSON.stringify({ enabled: false }),
    });
    assert.equal(off.status, 204);
    assert.equal(app.backend.execution.usingRealComfy(), false);
  } finally {
    await stopTestApp(app);
  }

  const held = new FakeExecutor({ behavior: "succeed-immediately" });
  const blocked = await startTestApp({
    executor: held,
    fallbackExecutor: held,
    allowRealComfy: false,
    useLocalComfy: true,
  });
  try {
    assert.equal(blocked.backend.execution.usingRealComfy(), false);
    assert.equal(blocked.backend.execution.getUseLocalComfy(), true);
  } finally {
    await stopTestApp(blocked);
  }
});
