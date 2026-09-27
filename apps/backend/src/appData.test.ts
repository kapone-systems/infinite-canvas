import assert from "node:assert/strict";
import { mkdtemp, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { AppDataError, APP_FOLDER_NAME, parseListenPort, parseServeWeb, resolveAppDataDir } from "./appData.ts";

const REAL_LOCAL = process.env.LOCALAPPDATA;
const REAL_CANVAS = REAL_LOCAL ? join(REAL_LOCAL, APP_FOLDER_NAME) : null;

test("--data-dir 优先于环境和 LOCALAPPDATA，不指向真实 CanvasApp", async () => {
  const root = await mkdtemp(join(tmpdir(), "canvas-appdata-"));
  const injected = join(root, "injected-data");
  const resolved = resolveAppDataDir({
    argv: ["--data-dir", injected],
    env: {
      LOCALAPPDATA: REAL_LOCAL ?? "C:\\Users\\Lenovo\\AppData\\Local",
      CANVAS_APP_DATA_DIR: join(root, "from-env"),
    },
  });
  assert.equal(resolved, resolve(injected));
  if (REAL_CANVAS !== null) {
    assert.notEqual(resolved, REAL_CANVAS);
  }
});

test("CANVAS_APP_DATA_DIR 在没有 --data-dir 时生效", async () => {
  const root = await mkdtemp(join(tmpdir(), "canvas-appdata-env-"));
  const fromEnv = join(root, "env-data");
  const resolved = resolveAppDataDir({
    argv: [],
    env: {
      LOCALAPPDATA: REAL_LOCAL ?? "C:\\Users\\Lenovo\\AppData\\Local",
      CANVAS_APP_DATA_DIR: fromEnv,
    },
  });
  assert.equal(resolved, resolve(fromEnv));
  if (REAL_CANVAS !== null) {
    assert.notEqual(resolved, REAL_CANVAS);
  }
});

test("默认路径是传入的 LOCALAPPDATA\\CanvasApp，不是写死用户目录", async () => {
  const root = await mkdtemp(join(tmpdir(), "canvas-appdata-default-"));
  const fakeLocal = join(root, "Local");
  await mkdir(fakeLocal, { recursive: true });
  const resolved = resolveAppDataDir({
    argv: [],
    env: { LOCALAPPDATA: fakeLocal },
  });
  assert.equal(resolved, join(fakeLocal, APP_FOLDER_NAME));
  if (REAL_CANVAS !== null) {
    assert.notEqual(resolved, REAL_CANVAS);
  }
});

test("没有 LOCALAPPDATA 且没有注入时启动失败", () => {
  assert.throws(
    () => resolveAppDataDir({ argv: [], env: {} }),
    (err: unknown) => err instanceof AppDataError && err.code === "MISSING_LOCALAPPDATA",
  );
});

test("parseListenPort 读 --port，非法则抛错", () => {
  assert.equal(parseListenPort([], {}, {}), 8787);
  assert.equal(parseListenPort(["--port", "9001"], {}, {}), 9001);
  assert.throws(() => parseListenPort(["--port", "0"], {}, {}));
  assert.throws(() => parseListenPort(["--port", "abc"], {}, {}));
});

test("parseServeWeb 认 --serve-web 与可选目录", () => {
  assert.deepEqual(parseServeWeb([]), { enabled: false, root: undefined });
  assert.deepEqual(parseServeWeb(["--port", "8787"]), { enabled: false, root: undefined });
  assert.deepEqual(parseServeWeb(["--serve-web"]), { enabled: true, root: undefined });
  assert.deepEqual(parseServeWeb(["--serve-web", "--port", "9"]), { enabled: true, root: undefined });
  assert.deepEqual(parseServeWeb(["--serve-web", "D:\\web-dist"]), { enabled: true, root: "D:\\web-dist" });
  assert.deepEqual(parseServeWeb(["--serve-web=D:\\web-dist"]), { enabled: true, root: "D:\\web-dist" });
});
