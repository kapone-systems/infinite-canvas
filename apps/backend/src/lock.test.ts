import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { acquireBackendLock, isPidAlive } from "./lock.ts";
import { BACKEND_MESSAGES } from "./messages.ts";

const mainPath = fileURLToPath(new URL("./main.ts", import.meta.url));

test("同一数据目录第二把锁失败且不杀第一进程", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "canvas-lock-"));
  await mkdir(join(dataDir, "locks"), { recursive: true });
  const first = acquireBackendLock(dataDir);
  assert.equal(first.ok, true);
  if (!first.ok) {
    return;
  }
  const pid = process.pid;
  const second = acquireBackendLock(dataDir);
  assert.equal(second.ok, false);
  if (!second.ok) {
    assert.equal(second.message, BACKEND_MESSAGES.lockHeld);
  }
  assert.equal(isPidAlive(pid), true);
  first.lock.release();
});

test("第二进程拿不到锁则退出，不杀持锁进程", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "canvas-lock-proc-"));
  await mkdir(join(dataDir, "locks"), { recursive: true });
  const held = acquireBackendLock(dataDir);
  assert.equal(held.ok, true);
  if (!held.ok) {
    return;
  }
  const parentPid = process.pid;
  const child = spawn(
    process.execPath,
    ["--experimental-strip-types", mainPath, "--data-dir", dataDir, "--port", "18787"],
    {
      env: { ...process.env, CANVAS_APP_DATA_DIR: dataDir },
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let stderr = "";
  child.stderr?.on("data", (chunk: Buffer) => {
    stderr += chunk.toString("utf8");
  });
  const code = await new Promise<number | null>((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("lock child timeout"));
    }, 15000);
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("exit", (exitCode) => {
      clearTimeout(timer);
      resolve(exitCode);
    });
  });
  assert.notEqual(code, 0);
  assert.match(stderr, /画布后端已经在运行/);
  assert.equal(isPidAlive(parentPid), true);
  const lockText = await readFile(held.lock.path, "utf8");
  assert.equal(Number.parseInt(lockText.trim(), 10), parentPid);
  held.lock.release();
});
