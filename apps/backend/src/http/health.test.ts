import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { portOccupiedMessage } from "@canvas/schema";
import { startBackend, STUB_FFMPEG } from "./createServer.ts";
import { probeFfmpegFfprobe } from "../ffmpegStatus.ts";
import { sessionTokenPath } from "../token.ts";

const TOKEN = "phase1-test-token";
const mainPath = fileURLToPath(new URL("../main.ts", import.meta.url));

test("GET /health 免令牌；ffmpeg missing 时仍 ok:true", async () => {
  const root = await mkdtemp(join(tmpdir(), "canvas-health-"));
  const dataDir = join(root, "data");
  await mkdir(dataDir, { recursive: true });
  const started = await startBackend({
    token: TOKEN,
    dataDir,
    ffmpeg: STUB_FFMPEG,
  });
  try {
    const res = await fetch(`${started.baseUrl}/health`);
    assert.equal(res.status, 200);
    const body = (await res.json()) as {
      ok: boolean;
      ffmpeg: string;
      ffprobe: string;
      ffmpegVersion: string | null;
      comfy: string;
      secretStore: string;
    };
    assert.equal(body.ok, true);
    assert.equal(body.ffmpeg, "missing");
    assert.equal(body.ffprobe, "missing");
    assert.equal(body.ffmpegVersion, null);
    assert.equal(body.comfy, "unconfigured");
    assert.equal(body.secretStore, "not-checked");
  } finally {
    await started.backend.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("本机探测 ffmpeg 缺失时形状仍是 ok 或 missing，不抛", async () => {
  const probed = await probeFfmpegFfprobe({ timeoutMs: 2000 });
  assert.ok(probed.ffmpeg === "missing" || probed.ffmpeg === "ok");
  assert.ok(probed.ffprobe === "missing" || probed.ffprobe === "ok");
  if (probed.ffmpeg === "missing") {
    assert.equal(probed.ffmpegVersion, null);
  }
});

function collect(child: ReturnType<typeof spawn>): { stdout: string; stderr: string } {
  const out = { stdout: "", stderr: "" };
  child.stdout?.on("data", (chunk: Buffer) => {
    out.stdout += chunk.toString("utf8");
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    out.stderr += chunk.toString("utf8");
  });
  return out;
}

test("终端打印含 #token= 的片段地址且令牌不进查询串", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "canvas-token-"));
  const probe = createServer();
  const freePort = await new Promise<number>((resolve, reject) => {
    probe.listen(0, "127.0.0.1", () => {
      const addr = probe.address();
      if (addr === null || typeof addr === "string") {
        reject(new Error("addr"));
        return;
      }
      resolve(addr.port);
    });
  });
  await new Promise<void>((resolve, reject) => {
    probe.close((err) => (err ? reject(err) : resolve()));
  });

  const child = spawn(
    process.execPath,
    ["--experimental-strip-types", mainPath, "--data-dir", dataDir, "--port", String(freePort)],
    {
      env: { ...process.env, CANVAS_APP_DATA_DIR: dataDir },
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  const out = collect(child);
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("token spawn timeout")), 15000);
      const onExit = (code: number | null): void => {
        clearTimeout(timer);
        reject(new Error(`exited ${code}: ${out.stderr}`));
      };
      child.on("exit", onExit);
      const onData = (): void => {
        if (out.stdout.includes("#token=")) {
          clearTimeout(timer);
          child.off("exit", onExit);
          resolve();
        }
      };
      child.stdout?.on("data", onData);
      onData();
    });
    assert.match(out.stdout, /#token=/);
    assert.doesNotMatch(out.stdout, /\?token=/);
    const match = /http:\/\/127\.0\.0\.1:\d+\/#token=([^\s]+)/.exec(out.stdout);
    assert.ok(match);
    const printed = match[1];
    assert.ok(printed);
    const fileToken = (await readFile(sessionTokenPath(dataDir), "utf8")).trim();
    assert.equal(printed, fileToken);
    assert.ok(!out.stdout.includes(`?token=${fileToken}`));
  } finally {
    child.kill();
    await new Promise((resolve) => child.once("exit", resolve));
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("端口占用则退出并打印方案句子，不杀占用者", async () => {
  const occupier = createServer();
  const port = await new Promise<number>((resolve) => {
    occupier.listen(0, "127.0.0.1", () => {
      const addr = occupier.address();
      assert.ok(addr !== null && typeof addr !== "string");
      resolve(addr.port);
    });
  });
  const dataDir = await mkdtemp(join(tmpdir(), "canvas-port-"));
  const child = spawn(
    process.execPath,
    ["--experimental-strip-types", mainPath, "--data-dir", dataDir, "--port", String(port)],
    {
      env: { ...process.env, CANVAS_APP_DATA_DIR: dataDir },
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  const out = collect(child);
  try {
    const code = await new Promise<number | null>((resolve, reject) => {
      const timer = setTimeout(() => {
        child.kill();
        reject(new Error("port child timeout"));
      }, 15000);
      child.on("exit", (exitCode) => {
        clearTimeout(timer);
        resolve(exitCode);
      });
    });
    assert.notEqual(code, 0);
    assert.equal(out.stderr.includes(portOccupiedMessage(port)), true);
    assert.equal(occupier.listening, true);
  } finally {
    child.kill();
    await new Promise<void>((resolve) => {
      occupier.close(() => resolve());
    });
    await rm(dataDir, { recursive: true, force: true });
  }
});
