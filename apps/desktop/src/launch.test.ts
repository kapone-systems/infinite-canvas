import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  LOCK_HELD_LINE,
  WEB_ROOT_MISSING_LINE,
  appendShellLog,
  appDataDir,
  backendNodeBin,
  backendSpawnSpec,
  childEnv,
  parseFragmentAddress,
  devShellPageUrl,
  packagedNodeBin,
  readExistingFragmentUrl,
  repoRootFromDesktopModule,
  shellLogDirectory,
  backendFailureDialog,
  userFacingStderr,
  windowChrome,
  windowWebPreferences,
} from "./launch.ts";

const moduleDir = fileURLToPath(new URL(".", import.meta.url));
const repoRoot = repoRootFromDesktopModule(moduleDir);

const nodeLiteral = "C:\\Program Files\\nodejs\\node.exe";

test("后端可执行文件是系统 Node 字面量，不用 process.execPath", async () => {
  const launchSrc = await readFile(new URL("./launch.ts", import.meta.url), "utf8");
  const mainSrc = await readFile(new URL("./main.ts", import.meta.url), "utf8");
  assert.equal(backendNodeBin, nodeLiteral);
  assert.equal(launchSrc.includes('backendNodeBin = "C:\\\\Program Files\\\\nodejs\\\\node.exe"'), true);
  assert.equal(launchSrc.includes("process.execPath"), false);
  assert.equal(mainSrc.includes("process.execPath"), false);
  assert.equal(launchSrc.includes("electron.exe"), true);
  assert.match(launchSrc, /delete env\.ELECTRON_RUN_AS_NODE/);
  assert.doesNotMatch(launchSrc, /ELECTRON_RUN_AS_NODE\s*=/);
  assert.doesNotMatch(mainSrc, /ELECTRON_RUN_AS_NODE\s*=/);
});

test("安装包里的 Node 和画布根在 resources 下，不写死本机路径", async () => {
  assert.equal(packagedNodeBin("D:\\app\\resources"), "D:\\app\\resources\\node\\node.exe");
  assert.equal(packagedNodeBin("D:\\app\\resources", "win32"), "D:\\app\\resources\\node\\node.exe");
  assert.equal(packagedNodeBin("D:\\app\\resources", "linux"), "D:\\app\\resources\\node\\node");
  assert.equal(packagedNodeBin("D:\\app\\resources").includes("Program Files\\nodejs"), false);
  const launchSrc = await readFile(new URL("./launch.ts", import.meta.url), "utf8");
  const mainSrc = await readFile(new URL("./main.ts", import.meta.url), "utf8");
  assert.match(launchSrc, /platform: string = "win32"/);
  assert.match(mainSrc, /packagedNodeBin\(process\.resourcesPath, process\.platform\)/);
  assert.equal(launchSrc.includes("process.execPath"), false);
  assert.equal(mainSrc.includes("process.execPath"), false);
});

test("默认仍传 --serve-web；CANVAS_SHELL_DEV=1 才改开开发页", () => {
  const prod = backendSpawnSpec(repoRoot, {});
  assert.equal(prod.args.includes("--serve-web"), true);
  const dev = backendSpawnSpec(repoRoot, { CANVAS_SHELL_DEV: "1" });
  assert.equal(dev.args.includes("--serve-web"), false);
  assert.equal(dev.args[0], "--experimental-strip-types");
  assert.equal(dev.shell, false);
});

test("拉起参数：系统 Node、仓库根、strip-types、main.ts、--serve-web、shell false、ipc", () => {
  const spec = backendSpawnSpec(repoRoot);
  assert.equal(spec.command, nodeLiteral);
  assert.equal(spec.command.toLowerCase().endsWith("electron.exe"), false);
  assert.equal(spec.shell, false);
  assert.equal(spec.cwd, resolve(repoRoot));
  assert.deepEqual(spec.stdio, ["ignore", "pipe", "pipe", "ipc"]);
  assert.deepEqual(spec.args, [
    "--experimental-strip-types",
    resolve(repoRoot, "apps", "backend", "src", "main.ts"),
    "--serve-web",
  ]);
  const env = childEnv({ ELECTRON_RUN_AS_NODE: "1", PATH: "kept" });
  assert.equal(env.ELECTRON_RUN_AS_NODE, undefined);
  assert.equal(env.PATH, "kept");
});

test("只接受 127.0.0.1 片段令牌，不接受查询串、file: 或其它主机", () => {
  const ok = parseFragmentAddress("http://127.0.0.1:8787/#token=abc");
  assert.ok(ok);
  assert.equal(ok.url, "http://127.0.0.1:8787/#token=abc");
  assert.equal(ok.token, "abc");
  assert.equal(ok.port, 8787);
  assert.equal(parseFragmentAddress("http://127.0.0.1:8787/?token=abc"), null);
  assert.equal(parseFragmentAddress("http://127.0.0.1:8787/?token=abc#token=abc"), null);
  assert.equal(parseFragmentAddress("file:///C:/media/a.png"), null);
  assert.equal(parseFragmentAddress("http://0.0.0.0:8787/#token=abc"), null);
  assert.equal(parseFragmentAddress("http://localhost:8787/#token=abc"), null);
  assert.equal(parseFragmentAddress(LOCK_HELD_LINE), null);
  assert.equal(parseFragmentAddress(WEB_ROOT_MISSING_LINE), null);
  assert.equal(devShellPageUrl("http://127.0.0.1:8787/#token=abc"), "http://127.0.0.1:5173/#token=abc");
  assert.equal(devShellPageUrl("http://127.0.0.1:8787/?token=abc"), null);
});

test("锁占用、缺界面文件、端口占用要能交给用户，且不是页面地址", () => {
  const portLine = "端口 8787 已被占用。如果画布后端已经在运行，请打开原来的地址；否则换一个端口再启动。";
  const stderr = `${LOCK_HELD_LINE}\n${WEB_ROOT_MISSING_LINE}\n${portLine}\nError: stack\n`;
  assert.deepEqual(userFacingStderr(stderr), [LOCK_HELD_LINE, WEB_ROOT_MISSING_LINE, portLine]);
  assert.equal(backendFailureDialog(stderr), [LOCK_HELD_LINE, WEB_ROOT_MISSING_LINE, portLine].join("\n"));
  assert.equal(parseFragmentAddress(portLine), null);
});

test("未知失败要带上原因，并丢掉令牌和堆栈", () => {
  const crash = "Error [ERR_MODULE_NOT_FOUND]: Cannot find package '@canvas/schema'\n    at Module._resolveFilename\n";
  assert.deepEqual(userFacingStderr(crash), []);
  assert.equal(
    backendFailureDialog(crash),
    "本机服务没连上。\nError [ERR_MODULE_NOT_FOUND]: Cannot find package '@canvas/schema'",
  );
  assert.equal(backendFailureDialog("http://127.0.0.1:8787/#token=abc\n    at hidden\n"), "本机服务没连上。");
  assert.equal(backendFailureDialog("test-key-not-real\n"), "本机服务没连上。");
  assert.equal(backendFailureDialog(""), "本机服务没连上。");
});

test("窗口隔离、有边框，源码没有 safeStorage、file://、托盘、无边框，不重写命中和撤销", async () => {
  const launchSrc = await readFile(new URL("./launch.ts", import.meta.url), "utf8");
  const mainSrc = await readFile(new URL("./main.ts", import.meta.url), "utf8");
  const combined = `${launchSrc}\n${mainSrc}`;
  assert.equal(windowWebPreferences.contextIsolation, true);
  assert.equal(windowWebPreferences.nodeIntegration, false);
  assert.equal(windowWebPreferences.sandbox, true);
  assert.equal(windowChrome.frame, true);
  assert.match(mainSrc, /webPreferences:\s*\{\s*\.\.\.windowWebPreferences\s*\}/);
  assert.match(mainSrc, /loadURL\(pageUrl\(parsed\.url\)\)/);
  assert.match(mainSrc, /child\.send\("shutdown"\)/);
  assert.doesNotMatch(combined, /safeStorage/);
  assert.doesNotMatch(combined, /file:\/\//);
  assert.doesNotMatch(combined, /loadFile\s*\(/);
  assert.doesNotMatch(combined, /frame:\s*false/);
  assert.doesNotMatch(combined, /\bTray\b/);
  assert.doesNotMatch(combined, /hitTest|undoStack|applyUndo/);
  assert.doesNotMatch(mainSrc, /\.kill\(|SIGINT|SIGTERM|taskkill/);
  assert.match(mainSrc, /CANVAS_SHELL_DEBUG_PORT/);
  assert.match(mainSrc, /remote-debugging-address", "127\.0\.0\.1"/);
});

test("壳日志在临时目录：片段令牌和 test-key-not-real 都是 0 次", async () => {
  const dir = await mkdtemp(join(tmpdir(), "canvas-shell-log-"));
  try {
    assert.equal(shellLogDirectory({ CANVAS_SHELL_LOG_DIR: dir, LOCALAPPDATA: "C:\\unused" }), resolve(dir));
    assert.equal(
      shellLogDirectory({ LOCALAPPDATA: "C:\\Users\\Lenovo\\AppData\\Local" }),
      join("C:\\Users\\Lenovo\\AppData\\Local", "CanvasApp", "logs"),
    );
    const token = "frag-token-sample";
    await appendShellLog(dir, `http://127.0.0.1:8787/#token=${token}`, token);
    await appendShellLog(dir, `泄漏 ${token} 以及 test-key-not-real`, token);
    await appendShellLog(dir, "backend ready", token);
    const text = await readFile(join(dir, "shell.log"), "utf8");
    assert.equal(text.split(token).length - 1, 0);
    assert.equal(text.split("#token=").length - 1, 0);
    assert.equal(text.split("test-key-not-real").length - 1, 0);
    assert.match(text, /backend ready/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("linux 数据目录和壳日志不依赖真的在 Linux 上跑", () => {
  const homedir = (): string => {
    throw new Error("不应调用");
  };
  assert.equal(appDataDir({ XDG_DATA_HOME: "/srv/canvas" }, "linux", homedir), "/srv/canvas/CanvasApp");
  assert.equal(shellLogDirectory({ XDG_DATA_HOME: "/srv/canvas" }, "linux", homedir), "/srv/canvas/CanvasApp/logs");
  assert.equal(appDataDir({ HOME: "/home/canvas" }, "linux", homedir), "/home/canvas/.local/share/CanvasApp");
  assert.equal(
    shellLogDirectory({ HOME: "/home/canvas" }, "linux", homedir),
    "/home/canvas/.local/share/CanvasApp/logs",
  );
  assert.equal(appDataDir({ HOME: "relative/home" }, "linux", homedir), null);
  assert.throws(
    () => shellLogDirectory({ HOME: "relative/home" }, "linux", homedir),
    (err: unknown) => err instanceof Error && !err.message.includes("LOCALAPPDATA"),
  );
  assert.equal(
    appDataDir({ CANVAS_APP_DATA_DIR: "D:\\custom", HOME: "/home/canvas" }, "linux", homedir),
    resolve("D:\\custom"),
  );
  assert.equal(
    shellLogDirectory({ CANVAS_SHELL_LOG_DIR: "D:\\logs", HOME: "relative/home" }, "linux", homedir),
    resolve("D:\\logs"),
  );
  assert.equal(appDataDir({ LOCALAPPDATA: "relative-local" }, "win32"), null);
});

test("端口上已有本后端时只拼片段地址，不杀占用者", async () => {
  const dir = await mkdtemp(join(tmpdir(), "canvas-attach-"));
  const token = "already-running-token";
  await writeFile(join(dir, "session.token"), `${token}\n`, "utf8");
  const occupier = createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, ffmpeg: "missing" }));
  });
  const port = await new Promise<number>((resolvePort, reject) => {
    occupier.listen(0, "127.0.0.1", () => {
      const addr = occupier.address();
      if (addr === null || typeof addr === "string") {
        reject(new Error("addr"));
        return;
      }
      resolvePort(addr.port);
    });
  });
  try {
    const url = await readExistingFragmentUrl(dir, port);
    assert.equal(url, `http://127.0.0.1:${port}/#token=${token}`);
    assert.equal(url?.includes("?"), false);
    assert.equal(occupier.listening, true);
  } finally {
    await new Promise<void>((resolveClose) => {
      occupier.close(() => resolveClose());
    });
    await rm(dir, { recursive: true, force: true });
  }
});
