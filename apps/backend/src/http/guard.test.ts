import assert from "node:assert/strict";
import { request } from "node:http";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { startBackend, STUB_FFMPEG, type Backend } from "./createServer.ts";
import { BACKEND_MESSAGES } from "../messages.ts";

const TOKEN = "phase1-test-token";

async function withApp(
  run: (input: { port: number; origin: string; baseUrl: string; backend: Backend }) => Promise<void>,
): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "canvas-guard-"));
  const dataDir = join(root, "data");
  await mkdir(dataDir, { recursive: true });
  const started = await startBackend({
    token: TOKEN,
    dataDir,
    ffmpeg: STUB_FFMPEG,
    homeDir: join(root, "home"),
  });
  try {
    await run(started);
  } finally {
    await started.backend.close();
    await rm(root, { recursive: true, force: true });
  }
}

function rawRequest(input: {
  port: number;
  path: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = request(
      {
        hostname: "127.0.0.1",
        port: input.port,
        path: input.path,
        method: input.method ?? "GET",
        headers: input.headers,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => {
          chunks.push(chunk);
        });
        res.on("end", () => {
          resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") });
        });
      },
    );
    req.on("error", reject);
    if (input.body !== undefined) {
      req.write(input.body);
    }
    req.end();
  });
}

test("只绑 127.0.0.1；Host 白名单；无令牌拒绝 /api；错误 Origin 拒绝；查询串令牌无效", async () => {
  await withApp(async ({ port, origin, backend }) => {
    const address = backend.server.address();
    assert.ok(address !== null && typeof address !== "string");
    assert.equal(address.address, "127.0.0.1");

    const health = await fetch(`http://127.0.0.1:${port}/health`);
    assert.equal(health.status, 200);

    const noToken = await fetch(`http://127.0.0.1:${port}/api/projects/current`);
    assert.equal(noToken.status, 401);
    const noTokenBody = (await noToken.json()) as { message: string };
    assert.equal(noTokenBody.message, BACKEND_MESSAGES.unauthorized);

    const queryToken = await fetch(`http://127.0.0.1:${port}/api/projects/current?token=${TOKEN}`);
    assert.equal(queryToken.status, 401);

    const withToken = await fetch(`http://127.0.0.1:${port}/api/projects/current`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    assert.equal(withToken.status, 404);

    const badHost = await rawRequest({
      port,
      path: "/health",
      headers: { Host: "example.com" },
    });
    assert.equal(badHost.status, 403);

    const goodHost = await rawRequest({
      port,
      path: "/health",
      headers: { Host: `127.0.0.1:${port}` },
    });
    assert.equal(goodHost.status, 200);

    const localhostHost = await rawRequest({
      port,
      path: "/health",
      headers: { Host: `localhost:${port}` },
    });
    assert.equal(localhostHost.status, 200);

    const noOrigin = await fetch(`http://127.0.0.1:${port}/api/projects`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ parentDir: "C:\\tmp", name: "x" }),
    });
    assert.equal(noOrigin.status, 403);

    const badOrigin = await fetch(`http://127.0.0.1:${port}/api/projects`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        Origin: "http://example.com",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ parentDir: "C:\\tmp", name: "x" }),
    });
    assert.equal(badOrigin.status, 403);
    assert.equal(badOrigin.headers.get("access-control-allow-origin"), null);

    const viteOrigin = await fetch(`http://127.0.0.1:${port}/api/projects/current`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        Origin: "http://127.0.0.1:5173",
        "Content-Type": "application/json",
      },
      body: "{}",
    });
    assert.equal(viteOrigin.status, 404);

    const selfOrigin = await fetch(`http://127.0.0.1:${port}/api/projects/current`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        Origin: origin,
        "Content-Type": "application/json",
      },
      body: "{}",
    });
    assert.equal(selfOrigin.status, 404);
  });
});
