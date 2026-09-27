import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { projectAutosavePath, projectFilePath } from "./project/atomicWrite.ts";
import { textNode } from "./http/testApp.ts";

const nodeBin = "C:\\Program Files\\nodejs\\node.exe";
const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));
const mainPath = fileURLToPath(new URL("./main.ts", import.meta.url));

type Started = {
  child: ChildProcess;
  port: number;
  token: string;
  origin: string;
  root: string;
  projectsDir: string;
};

function collect(child: ChildProcess): { stdout: string; stderr: string } {
  const out = { stdout: "", stderr: "" };
  child.stdout?.on("data", (chunk: Buffer) => {
    out.stdout += chunk.toString("utf8");
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    out.stderr += chunk.toString("utf8");
  });
  return out;
}

async function freePort(): Promise<number> {
  const probe = createServer();
  const port = await new Promise<number>((resolve, reject) => {
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
  return port;
}

async function startRealBackend(): Promise<Started> {
  assert.equal(existsSync(nodeBin), true);
  const root = await mkdtemp(join(tmpdir(), "canvas-desktop-shutdown-"));
  const dataDir = join(root, "data");
  const projectsDir = join(root, "projects");
  const webRoot = join(root, "web");
  await mkdir(projectsDir, { recursive: true });
  await mkdir(webRoot, { recursive: true });
  await writeFile(join(webRoot, "index.html"), "<!doctype html><title>canvas</title>\n", "utf8");
  const port = await freePort();
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(
    nodeBin,
    [
      "--experimental-strip-types",
      mainPath,
      "--data-dir",
      dataDir,
      "--port",
      String(port),
      "--serve-web",
      webRoot,
    ],
    {
      cwd: repoRoot,
      env,
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe", "ipc"],
    },
  );
  const out = collect(child);
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`token spawn timeout\n${out.stderr}`)), 20000);
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
  const match = /http:\/\/127\.0\.0\.1:(\d+)\/#token=(\S+)/.exec(out.stdout);
  assert.ok(match);
  const printedPort = Number(match[1]);
  const token = match[2];
  assert.equal(printedPort, port);
  assert.ok(token);
  assert.equal(out.stdout.includes("?token="), false);
  return {
    child,
    port,
    token,
    origin: `http://127.0.0.1:${port}`,
    root,
    projectsDir,
  };
}

async function stopChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) {
    return;
  }
  child.send("shutdown");
  const exited = await Promise.race([
    new Promise<boolean>((resolve) => {
      child.once("exit", () => resolve(true));
    }),
    new Promise<boolean>((resolve) => {
      setTimeout(() => resolve(false), 8000);
    }),
  ]);
  if (!exited && child.exitCode === null) {
    child.kill();
    await new Promise((resolve) => child.once("exit", resolve));
  }
}

async function readOrEmpty(path: string): Promise<string> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return "";
  }
}

function boatBody(contentRevision: number): string {
  return JSON.stringify({
    contentRevision,
    nodes: { n1: textNode("n1", "一只纸船") },
    edges: {},
    groups: {},
  });
}

test("关窗 IPC：PUT 带令牌、Origin 和 contentRevision 后，防抖未到就写出自动保存", { timeout: 40000 }, async () => {
  const started = await startRealBackend();
  let projectDir = "";
  try {
    const created = await fetch(`${started.origin}/api/projects`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${started.token}`,
        Origin: started.origin,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ parentDir: started.projectsDir, name: "paperboat" }),
    });
    const createdText = await created.text();
    assert.equal(created.status, 201, createdText);
    const createdBody = JSON.parse(createdText) as { absolutePath?: string };
    assert.equal(typeof createdBody.absolutePath, "string");
    projectDir = createdBody.absolutePath as string;

    const putStarted = Date.now();
    const put = await fetch(`${started.origin}/api/projects/current/working-copy`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${started.token}`,
        Origin: started.origin,
        "Content-Type": "application/json",
      },
      body: boatBody(0),
    });
    assert.equal(put.status, 204);
    const sent = started.child.send("shutdown");
    const elapsed = Date.now() - putStarted;
    assert.equal(sent, true);
    assert.ok(elapsed < 1000, `shutdown 晚于防抖：${elapsed}ms`);
    const code = await new Promise<number | null>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("shutdown timeout")), 15000);
      started.child.once("exit", (exitCode) => {
        clearTimeout(timer);
        resolve(exitCode);
      });
    });
    assert.equal(code, 0);

    const autosave = JSON.parse(await readFile(projectAutosavePath(projectDir), "utf8")) as {
      contentRevision: number;
      nodes: { n1?: { text?: string } };
    };
    assert.equal(autosave.contentRevision, 1);
    assert.equal(autosave.nodes.n1?.text, "一只纸船");
    const official = await readFile(projectFilePath(projectDir), "utf8");
    assert.equal(official.includes("一只纸船"), false);
    const officialJson = JSON.parse(official) as { contentRevision: number };
    assert.equal(officialJson.contentRevision, 0);
  } finally {
    await stopChild(started.child);
    await rm(started.root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});

test("只 POST 不 PUT，关窗刷出的自动保存里没有这句", { timeout: 40000 }, async () => {
  const started = await startRealBackend();
  let projectDir = "";
  try {
    const created = await fetch(`${started.origin}/api/projects`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${started.token}`,
        Origin: started.origin,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ parentDir: started.projectsDir, name: "emptyboat" }),
    });
    const createdText = await created.text();
    assert.equal(created.status, 201, createdText);
    const createdBody = JSON.parse(createdText) as { absolutePath?: string };
    projectDir = createdBody.absolutePath as string;
    assert.equal(started.child.send("shutdown"), true);
    const code = await new Promise<number | null>((resolve) => {
      started.child.once("exit", (exitCode) => resolve(exitCode));
    });
    assert.equal(code, 0);
    const autosave = await readOrEmpty(projectAutosavePath(projectDir));
    const official = await readOrEmpty(projectFilePath(projectDir));
    assert.equal(autosave.includes("一只纸船"), false);
    assert.equal(official.includes("一只纸船"), false);
  } finally {
    await stopChild(started.child);
    await rm(started.root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});

test("缺 Bearer、Origin 或 contentRevision 对不上时，关窗也不算写入这句", { timeout: 40000 }, async () => {
  const started = await startRealBackend();
  let projectDir = "";
  try {
    const created = await fetch(`${started.origin}/api/projects`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${started.token}`,
        Origin: started.origin,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ parentDir: started.projectsDir, name: "rejectboat" }),
    });
    const createdText = await created.text();
    assert.equal(created.status, 201, createdText);
    const createdBody = JSON.parse(createdText) as { absolutePath?: string };
    projectDir = createdBody.absolutePath as string;
    const url = `${started.origin}/api/projects/current/working-copy`;
    const noBearer = await fetch(url, {
      method: "PUT",
      headers: { Origin: started.origin, "Content-Type": "application/json" },
      body: boatBody(0),
    });
    assert.notEqual(noBearer.status, 204);
    const noOrigin = await fetch(url, {
      method: "PUT",
      headers: { Authorization: `Bearer ${started.token}`, "Content-Type": "application/json" },
      body: boatBody(0),
    });
    assert.notEqual(noOrigin.status, 204);
    const wrongRevision = await fetch(url, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${started.token}`,
        Origin: started.origin,
        "Content-Type": "application/json",
      },
      body: boatBody(9),
    });
    assert.notEqual(wrongRevision.status, 204);
    const sentAt = Date.now();
    assert.equal(started.child.send("shutdown"), true);
    assert.ok(Date.now() - sentAt < 1000);
    const code = await new Promise<number | null>((resolve) => {
      started.child.once("exit", (exitCode) => resolve(exitCode));
    });
    assert.equal(code, 0);
    const autosave = await readOrEmpty(projectAutosavePath(projectDir));
    const official = await readOrEmpty(projectFilePath(projectDir));
    assert.equal(autosave.includes("一只纸船"), false);
    assert.equal(official.includes("一只纸船"), false);
    if (autosave.length > 0) {
      const parsed = JSON.parse(autosave) as { contentRevision?: number; nodes?: { n1?: { text?: string } } };
      assert.notEqual(parsed.nodes?.n1?.text, "一只纸船");
      assert.notEqual(parsed.contentRevision, 1);
    }
  } finally {
    await stopChild(started.child);
    await rm(started.root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});
