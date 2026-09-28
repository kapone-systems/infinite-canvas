/**
 * 本机假 HTTP，不是用户的 Comfy，也不是 5090。
 * 报文路径和字段保持拟定，未验证。
 */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { USER_FACING } from "@canvas/schema";
import { spawn } from "node:child_process";
import { ComfyHttpExecutor } from "./client.ts";
import { askpassExeBytes } from "../../ssh/askpassExe.ts";
import { argvRequestsFakeExecutor, readUseLocalComfySync, shouldUseRealComfy, writeUseLocalComfy } from "../useLocalComfy.ts";
import { fictionalSuccessPng } from "../fakeExecutor.ts";
import { createProject, headers, startTestApp, stopTestApp, txt2imgNode } from "../../http/testApp.ts";

test("开关缺省为关，且不写进别的文件", async () => {
  const dir = await mkdtemp(join(tmpdir(), "use-local-"));
  try {
    assert.equal(readUseLocalComfySync(dir), false);
    assert.equal(shouldUseRealComfy({ enabled: false, fakeExecutorFlag: false }), false);
    assert.equal(shouldUseRealComfy({ enabled: true, fakeExecutorFlag: true }), false);
    assert.equal(shouldUseRealComfy({ enabled: true, fakeExecutorFlag: false }), true);
    assert.equal(argvRequestsFakeExecutor(["--port", "1"]), false);
    assert.equal(argvRequestsFakeExecutor(["--fake-executor", "hang-then-succeed"]), true);
    assert.equal(argvRequestsFakeExecutor(["--fake-executor=succeed-on-cancel"]), true);
    await writeUseLocalComfy(dir, true);
    assert.equal(readUseLocalComfySync(dir), true);
    const raw = await readFile(join(dir, "use-local-comfy.json"), "utf8");
    assert.equal(raw.includes("comfyBaseUrl"), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("假 HTTP：提交、上传、取图、取消。没有连用户的 Comfy", async () => {
  const png = fictionalSuccessPng();
  let promptBody = "";
  let uploadBody = "";
  let interruptCount = 0;
  let viewCount = 0;
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
    });
    req.on("end", () => {
      const body = Buffer.concat(chunks);
      const url = req.url ?? "";
      if (req.method === "POST" && url === "/prompt") {
        promptBody = body.toString("utf8");
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ prompt_id: "job-1", number: 1 }));
        return;
      }
      if (req.method === "POST" && url === "/upload/image") {
        uploadBody = body.toString("utf8");
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ name: "uploaded.png", subfolder: "", type: "input" }));
        return;
      }
      if (req.method === "GET" && url.startsWith("/history/")) {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({
          "job-1": {
            status: { completed: true, status_str: "success" },
            outputs: {
              "9": { images: [{ filename: "out.png", subfolder: "", type: "output" }] },
            },
          },
        }));
        return;
      }
      if (req.method === "GET" && url.startsWith("/view")) {
        viewCount += 1;
        res.writeHead(200, { "content-type": "image/png" });
        res.end(png);
        return;
      }
      if (req.method === "POST" && url === "/interrupt") {
        interruptCount += 1;
        res.writeHead(200);
        res.end();
        return;
      }
      res.writeHead(404);
      res.end();
    });
  });
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  const port = address !== null && typeof address !== "string" ? address.port : 0;
  const executor = new ComfyHttpExecutor({ baseUrl: () => `http://127.0.0.1:${port}` });
  try {
    assert.equal(executor.inspectPrompt("missing").kind, "unreachable");
    const uploaded = await executor.uploadImage({ bytes: png, mime: "image/png", filename: "ref.png" });
    assert.equal(uploaded.name, "uploaded.png");
    assert.equal(uploadBody.includes("name=\"image\""), true);
    assert.equal(uploadBody.includes("filename=\"ref.png\""), true);
    const submitted = await executor.submit({
      taskId: "t1",
      promptText: "一只纸船",
      prompt: { positive: { class_type: "Fictional", inputs: { text: "一只纸船" } } },
    });
    assert.equal(submitted.promptId, "job-1");
    assert.equal(promptBody.includes("prompt_id"), false);
    assert.equal(promptBody.includes("\"prompt\""), true);
    assert.equal(executor.inspectPrompt("job-1").kind, "queued");
    const waited = await executor.wait("job-1", new AbortController().signal);
    assert.equal(waited.ok, true);
    if (waited.ok) {
      assert.equal(waited.images.length, 1);
      assert.equal(Buffer.from(waited.images[0]?.bytes ?? []).equals(Buffer.from(png)), true);
      assert.equal(waited.images[0]?.mime, "image/png");
    }
    assert.equal(viewCount, 1);
    assert.equal(executor.inspectPrompt("job-1").kind, "succeeded");
    const pending = createServer((req, res) => {
      if (req.method === "GET" && (req.url ?? "").startsWith("/history/")) {
        res.writeHead(200, { "content-type": "application/json" });
        res.end("{}");
        return;
      }
      if (req.method === "POST" && req.url === "/interrupt") {
        interruptCount += 1;
        res.writeHead(200);
        res.end();
        return;
      }
      res.writeHead(404);
      res.end();
    });
    await new Promise<void>((resolve) => {
      pending.listen(0, "127.0.0.1", () => resolve());
    });
    const pendingAddress = pending.address();
    const pendingPort = pendingAddress !== null && typeof pendingAddress !== "string" ? pendingAddress.port : 0;
    const cancelling = new ComfyHttpExecutor({ baseUrl: () => `http://127.0.0.1:${pendingPort}` });
    const signal = new AbortController();
    const hanging = cancelling.wait("job-2", signal.signal);
    await new Promise((resolve) => setTimeout(resolve, 50));
    await cancelling.interrupt("job-2");
    signal.abort();
    const cancelled = await hanging;
    assert.equal(cancelled.ok, false);
    if (!cancelled.ok) {
      assert.equal(cancelled.code, "cancelled");
      assert.equal(cancelled.message, USER_FACING.cancelledNoResult);
    }
    assert.equal(interruptCount >= 1, true);
    await new Promise<void>((resolve, reject) => {
      pending.close((err) => {
        if (err) {
          reject(err);
          return;
        }
        resolve();
      });
    });
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => {
        if (err) {
          reject(err);
          return;
        }
        resolve();
      });
    });
  }
});

test("askpass.exe 能被直接执行，文件里没有口令", { skip: process.platform !== "win32" }, async () => {
  const dir = await mkdtemp(join(tmpdir(), "askpass-exe-"));
  const password = "askpass-unit-secret";
  const exe = join(dir, "askpass.exe");
  const secret = join(dir, "askpass.secret");
  try {
    const bytes = askpassExeBytes();
    assert.equal(bytes.subarray(0, 2).toString("latin1"), "MZ");
    assert.equal(bytes.includes(Buffer.from(password)), false);
    await import("node:fs/promises").then((fs) => fs.writeFile(exe, bytes));
    await import("node:fs/promises").then((fs) => fs.writeFile(secret, password));
    const output = await new Promise<Buffer>((resolve, reject) => {
      const child = spawn(exe, [], { shell: false, windowsHide: true });
      const chunks: Buffer[] = [];
      child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
      child.on("error", reject);
      child.on("exit", (code) => {
        if (code !== 0) {
          reject(new Error(`exit ${code}`));
          return;
        }
        resolve(Buffer.concat(chunks));
      });
    });
    assert.equal(output.toString("utf8"), password);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("开关打开时文生图打到假 HTTP，替身没有收到提交", async () => {
  const png = fictionalSuccessPng();
  let prompts = 0;
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const url = req.url ?? "";
      if (url.startsWith("/object_info")) {
        res.writeHead(200, { "content-type": "application/json" });
        res.end("{}");
        return;
      }
      if (req.method === "POST" && url === "/prompt") {
        prompts += 1;
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ prompt_id: `job-${prompts}` }));
        return;
      }
      if (req.method === "GET" && url.startsWith("/history/")) {
        const id = decodeURIComponent(url.slice("/history/".length));
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({
          [id]: {
            status: { completed: true, status_str: "success" },
            outputs: { "9": { images: [{ filename: "out.png", subfolder: "", type: "output" }] } },
          },
        }));
        return;
      }
      if (req.method === "GET" && url.startsWith("/view")) {
        res.writeHead(200, { "content-type": "image/png" });
        res.end(png);
        return;
      }
      res.writeHead(404);
      res.end();
    });
  });
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  const port = address !== null && typeof address !== "string" ? address.port : 0;
  const { FakeExecutor } = await import("../fakeExecutor.ts");
  const fake = new FakeExecutor({ behavior: "succeed-immediately" });
  const app = await startTestApp({
    executor: fake,
    fallbackExecutor: fake,
    allowRealComfy: true,
    useLocalComfy: true,
    comfyBaseUrl: `http://127.0.0.1:${port}`,
  });
  try {
    assert.equal(app.backend.execution.usingRealComfy(), true);
    const created = await createProject(app, "real-exec");
    assert.equal(created.status, 201);
    const projectId = created.body.projectId as string;
    const put = await fetch(`${app.baseUrl}/api/projects/current/working-copy`, {
      method: "PUT",
      headers: headers(app.origin),
      body: JSON.stringify({
        contentRevision: 0,
        nodes: { g1: txt2imgNode("g1") },
        edges: {},
        groups: {},
      }),
    });
    assert.equal(put.status, 204);
    const run = await fetch(`${app.baseUrl}/api/execution/runs`, {
      method: "POST",
      headers: headers(app.origin),
      body: JSON.stringify({
        projectId,
        scope: { type: "node", nodeId: "g1" },
        force: false,
        clientRequestId: "real-1",
      }),
    });
    assert.equal(run.status, 200);
    const started = Date.now();
    let phase = "";
    while (Date.now() - started < 8000) {
      const current = await fetch(`${app.baseUrl}/api/projects/current`, {
        headers: { Authorization: `Bearer ${app.token}` },
      });
      const body = await current.json() as { project: { nodes: Record<string, { phase?: string }> } };
      phase = body.project.nodes.g1?.phase ?? "";
      if (phase === "succeeded" || phase === "failed") {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 40));
    }
    assert.equal(phase, "succeeded");
    assert.equal(prompts, 1);
    assert.equal(fake.submitted.length, 0);
  } finally {
    await stopTestApp(app);
    await new Promise<void>((resolve, reject) => {
      server.close((err) => {
        if (err) {
          reject(err);
          return;
        }
        resolve();
      });
    });
  }
});
