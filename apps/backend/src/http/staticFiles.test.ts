import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer, request } from "node:http";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { USER_FACING } from "@canvas/schema";
import { BACKEND_MESSAGES } from "../messages.ts";
import { resolveWebRoot } from "../main.ts";
import { startBackend, STUB_FFMPEG } from "./createServer.ts";
import { defaultWebRoot, resolveStaticCandidate } from "./staticFiles.ts";

const TOKEN = "phase1-test-token";
const mainPath = fileURLToPath(new URL("../main.ts", import.meta.url));

async function withWebRoot(
  files: Record<string, string>,
  run: (input: { origin: string; webRoot: string; token: string }) => Promise<void>,
): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "canvas-serve-web-"));
  const dataDir = join(root, "data");
  const webRoot = join(root, "web");
  await mkdir(dataDir, { recursive: true });
  await mkdir(join(webRoot, "assets"), { recursive: true });
  for (const [rel, body] of Object.entries(files)) {
    const full = join(webRoot, rel);
    await mkdir(join(full, ".."), { recursive: true });
    await writeFile(full, body, "utf8");
  }
  const started = await startBackend({
    token: TOKEN,
    dataDir,
    ffmpeg: STUB_FFMPEG,
    homeDir: join(root, "home"),
    webRoot,
  });
  try {
    await run({ origin: started.origin, webRoot, token: TOKEN });
  } finally {
    await started.backend.close();
    await rm(root, { recursive: true, force: true });
  }
}

test("resolveStaticCandidate 拒绝跳出 webRoot", () => {
  const root = join(tmpdir(), "canvas-web-root");
  assert.equal(resolveStaticCandidate(root, "/"), root);
  assert.equal(resolveStaticCandidate(root, "/assets/app.js")?.endsWith(join("assets", "app.js")), true);
  assert.equal(resolveStaticCandidate(root, "/../secret.txt"), null);
  assert.equal(resolveStaticCandidate(root, "/%2e%2e/secret.txt"), null);
  assert.equal(resolveStaticCandidate(root, "/foo/../../secret.txt"), null);
});

test("--serve-web：无令牌 GET / 是 HTML，不是 401 JSON；API 仍要令牌", async () => {
  await withWebRoot(
    {
      "index.html":
        '<!doctype html><html lang="zh-CN"><body><div id="root"></div><p>还没有工程</p><button>新建工程</button></body></html>',
      "assets/app.js": "console.log('ok')",
    },
    async ({ origin, token }) => {
      const page = await fetch(`${origin}/`);
      assert.equal(page.status, 200);
      const contentType = page.headers.get("content-type") ?? "";
      assert.match(contentType, /text\/html/);
      const html = await page.text();
      assert.match(html, /还没有工程/);
      assert.match(html, /新建工程/);
      assert.doesNotMatch(html, /需要令牌/);

      const asset = await fetch(`${origin}/assets/app.js`);
      assert.equal(asset.status, 200);
      assert.match(asset.headers.get("content-type") ?? "", /javascript/);

      const noTokenApi = await fetch(`${origin}/api/projects/current`);
      assert.equal(noTokenApi.status, 401);
      const noTokenBody = (await noTokenApi.json()) as { message: string };
      assert.equal(noTokenBody.message, BACKEND_MESSAGES.unauthorized);

      const withToken = await fetch(`${origin}/api/projects/current`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      assert.equal(withToken.status, 404);
      const current = (await withToken.json()) as { message: string };
      assert.equal(current.message, USER_FACING.noProject);

      const health = await fetch(`${origin}/health`);
      assert.equal(health.status, 200);
      const healthBody = (await health.json()) as { ok: boolean };
      assert.equal(healthBody.ok, true);

      const traversal = await new Promise<{ status: number; body: string }>((resolve, reject) => {
        const url = new URL(origin);
        const req = request(
          {
            hostname: "127.0.0.1",
            port: Number(url.port),
            path: "/%2e%2e/secret.txt",
            method: "GET",
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
        req.end();
      });
      assert.equal(traversal.status === 403 || traversal.status === 404, true);
      assert.equal(traversal.body.includes("SECRET"), false);
    },
  );
});

test("默认 dist：GET / 出构建页，脚本里有还没有工程和新建工程", async () => {
  const dist = defaultWebRoot();
  const indexPath = join(dist, "index.html");
  let indexHtml: string;
  try {
    indexHtml = await readFile(indexPath, "utf8");
  } catch {
    assert.fail(`expected built web at ${indexPath}`);
    return;
  }
  const root = await mkdtemp(join(tmpdir(), "canvas-serve-dist-"));
  const dataDir = join(root, "data");
  await mkdir(dataDir, { recursive: true });
  const started = await startBackend({
    token: TOKEN,
    dataDir,
    ffmpeg: STUB_FFMPEG,
    homeDir: join(root, "home"),
    webRoot: dist,
  });
  try {
    const page = await fetch(`${started.origin}/`);
    assert.equal(page.status, 200);
    assert.match(page.headers.get("content-type") ?? "", /text\/html/);
    const html = await page.text();
    assert.match(html, /<div id="root">/);
    assert.equal(html.includes("需要令牌"), false);
    const scriptMatch = /src="(\/assets\/[^"]+\.js)"/.exec(html) ?? /src="(\/assets\/[^"]+\.js)"/.exec(indexHtml);
    assert.ok(scriptMatch);
    const scriptPath = scriptMatch[1];
    assert.ok(scriptPath);
    const scriptRes = await fetch(`${started.origin}${scriptPath}`);
    assert.equal(scriptRes.status, 200);
    const script = await scriptRes.text();
    assert.match(script, /还没有工程/);
    assert.match(script, /新建工程/);
    assert.match(script, /no-project/);
  } finally {
    await started.backend.close();
    await rm(root, { recursive: true, force: true });
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

function waitForExit(child: ReturnType<typeof spawn>, timeoutMs: number, label: string): Promise<number | null> {
  return new Promise((resolve, reject) => {
    if (child.exitCode !== null) {
      resolve(child.exitCode);
      return;
    }
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(label));
    }, timeoutMs);
    child.once("exit", (code) => {
      clearTimeout(timer);
      resolve(code);
    });
  });
}

async function killChild(child: ReturnType<typeof spawn>): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  child.kill();
  await new Promise<void>((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolve();
      return;
    }
    child.once("exit", () => resolve());
  });
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

test("未传 --serve-web 时，已构建的 dist 仍作为终端地址的静态根", () => {
  const result = resolveWebRoot([]);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.root, defaultWebRoot());
  }
});

test("未配置 webRoot 时 GET / 仍是 401 JSON", async () => {
  const root = await mkdtemp(join(tmpdir(), "canvas-no-static-"));
  const dataDir = join(root, "data");
  await mkdir(dataDir, { recursive: true });
  const started = await startBackend({
    token: TOKEN,
    dataDir,
    ffmpeg: STUB_FFMPEG,
    homeDir: join(root, "home"),
  });
  try {
    const page = await fetch(`${started.origin}/`);
    assert.equal(page.status, 401);
    assert.match(page.headers.get("content-type") ?? "", /json/);
    const body = (await page.json()) as { message: string };
    assert.equal(body.message, BACKEND_MESSAGES.unauthorized);
  } finally {
    await started.backend.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("启动后端（不传 --serve-web）：终端地址 GET / 仍是构建页", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "canvas-serve-default-"));
  const port = await freePort();
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
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`default serve spawn timeout: ${out.stderr}`)), 15000);
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
    const match = /http:\/\/127\.0\.0\.1:(\d+)\/#token=([^\s]+)/.exec(out.stdout);
    assert.ok(match);
    const bound = match[1];
    const token = match[2];
    assert.ok(bound);
    assert.ok(token);
    const page = await fetch(`http://127.0.0.1:${bound}/`);
    assert.equal(page.status, 200);
    assert.match(page.headers.get("content-type") ?? "", /text\/html/);
    const html = await page.text();
    assert.match(html, /<div id="root">/);
    assert.equal(html.includes("需要令牌"), false);
    const scriptMatch = /src="(\/assets\/[^"]+\.js)"/.exec(html);
    assert.ok(scriptMatch);
    const scriptPath = scriptMatch[1];
    assert.ok(scriptPath);
    const scriptRes = await fetch(`http://127.0.0.1:${bound}${scriptPath}`);
    assert.equal(scriptRes.status, 200);
    const script = await scriptRes.text();
    assert.match(script, /还没有工程/);
    assert.match(script, /新建工程/);
    const current = await fetch(`http://127.0.0.1:${bound}/api/projects/current`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(current.status, 404);
    const body = (await current.json()) as { message: string };
    assert.equal(body.message, USER_FACING.noProject);
  } finally {
    await killChild(child);
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("启动后端 --serve-web：终端地址 GET / 免令牌出 HTML", async () => {
  const root = await mkdtemp(join(tmpdir(), "canvas-serve-cli-"));
  const dataDir = join(root, "data");
  const webRoot = join(root, "web");
  await mkdir(dataDir, { recursive: true });
  await mkdir(webRoot, { recursive: true });
  await writeFile(
    join(webRoot, "index.html"),
    '<!doctype html><html lang="zh-CN"><body><div id="root"></div><p>还没有工程</p><button>新建工程</button></body></html>',
    "utf8",
  );
  const port = await freePort();

  const child = spawn(
    process.execPath,
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
      env: { ...process.env, CANVAS_APP_DATA_DIR: dataDir },
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  const out = collect(child);
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`serve-web spawn timeout: ${out.stderr}`)), 15000);
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
    const match = /http:\/\/127\.0\.0\.1:(\d+)\/#token=([^\s]+)/.exec(out.stdout);
    assert.ok(match);
    const port = match[1];
    const token = match[2];
    assert.ok(port);
    assert.ok(token);
    const page = await fetch(`http://127.0.0.1:${port}/`);
    assert.equal(page.status, 200);
    assert.match(page.headers.get("content-type") ?? "", /text\/html/);
    const html = await page.text();
    assert.match(html, /还没有工程/);
    assert.match(html, /新建工程/);
    const current = await fetch(`http://127.0.0.1:${port}/api/projects/current`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(current.status, 404);
    const body = (await current.json()) as { message: string };
    assert.equal(body.message, USER_FACING.noProject);
  } finally {
    await killChild(child);
    await rm(root, { recursive: true, force: true });
  }
});

test("--serve-web 指向没有 index.html 的目录则退出", async () => {
  const root = await mkdtemp(join(tmpdir(), "canvas-serve-missing-"));
  const dataDir = join(root, "data");
  const emptyWeb = join(root, "empty");
  await mkdir(dataDir, { recursive: true });
  await mkdir(emptyWeb, { recursive: true });
  const port = await freePort();
  const child = spawn(
    process.execPath,
    [
      "--experimental-strip-types",
      mainPath,
      "--data-dir",
      dataDir,
      "--port",
      String(port),
      "--serve-web",
      emptyWeb,
    ],
    {
      env: { ...process.env, CANVAS_APP_DATA_DIR: dataDir },
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  const out = collect(child);
  try {
    const code = await waitForExit(child, 15000, "missing web root timeout");
    assert.notEqual(code, 0);
    assert.equal(out.stderr.includes(BACKEND_MESSAGES.webRootMissing), true);
  } finally {
    await killChild(child);
    await rm(root, { recursive: true, force: true });
  }
});
