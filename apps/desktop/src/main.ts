import { app, BrowserWindow, dialog } from "electron";
import { fileURLToPath } from "node:url";
import type { ChildProcess } from "node:child_process";
import {
  appendShellLog,
  appDataDir,
  attachPort,
  consumeLines,
  parseFragmentAddress,
  readExistingFragmentUrl,
  repoRootFromDesktopModule,
  shellLogDirectory,
  shouldAttachExisting,
  spawnBackend,
  backendFailureDialog,
  windowChrome,
  windowWebPreferences,
  devShellPageUrl,
  packagedCanvasRoot,
  packagedNodeBin,
  backendNodeBin,
} from "./launch.js";

const moduleDir = fileURLToPath(new URL(".", import.meta.url));

function canvasRoot(): string {
  return app.isPackaged ? packagedCanvasRoot(process.resourcesPath) : repoRootFromDesktopModule(moduleDir);
}

function nodeBinary(): string {
  return app.isPackaged ? packagedNodeBin(process.resourcesPath, process.platform) : backendNodeBin;
}

const debugPort = process.env.CANVAS_SHELL_DEBUG_PORT;
if (debugPort !== undefined && /^[0-9]+$/.test(debugPort)) {
  app.commandLine.appendSwitch("remote-debugging-address", "127.0.0.1");
  app.commandLine.appendSwitch("remote-debugging-port", debugPort);
}
const shellUserData = process.env.CANVAS_SHELL_USER_DATA;
if (shellUserData !== undefined && shellUserData.length > 0) {
  app.setPath("userData", shellUserData);
}

let win: BrowserWindow | null = null;
let sessionToken: string | null = null;
let logDir: string | null = null;

function note(line: string): void {
  if (logDir === null || line.length === 0) {
    return;
  }
  void appendShellLog(logDir, line, sessionToken).catch(() => undefined);
}

function pageUrl(url: string): string {
  if (process.env.CANVAS_SHELL_DEV !== "1") {
    return url;
  }
  return devShellPageUrl(url) ?? url;
}

function openPage(url: string, child: ChildProcess): void {
  const parsed = parseFragmentAddress(url);
  if (parsed === null) {
    return;
  }
  sessionToken = parsed.token;
  win = new BrowserWindow({
    width: windowChrome.width,
    height: windowChrome.height,
    frame: windowChrome.frame,
    webPreferences: { ...windowWebPreferences },
  });
  bindShutdown(win, child);
  void win.loadURL(pageUrl(parsed.url));
}

function bindShutdown(window: BrowserWindow, child: ChildProcess): void {
  let closing = false;
  window.on("close", (event) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      return;
    }
    if (closing) {
      return;
    }
    event.preventDefault();
    closing = true;
    child.send("shutdown");
    child.once("exit", () => {
      if (!window.isDestroyed()) {
        window.destroy();
      }
    });
  });
}

function showBackendMessage(stderr: string): void {
  dialog.showErrorBox("画布", backendFailureDialog(stderr));
  app.quit();
}

async function attachOrExplain(child: ChildProcess, stderr: string): Promise<void> {
  if (win !== null) {
    return;
  }
  if (shouldAttachExisting(stderr)) {
    const dataDir = appDataDir(process.env);
    if (dataDir !== null) {
      const url = await readExistingFragmentUrl(dataDir, attachPort(stderr, dataDir));
      if (url !== null) {
        openPage(url, child);
        return;
      }
    }
  }
  showBackendMessage(stderr);
}

function start(): void {
  try {
    logDir = shellLogDirectory(process.env);
  } catch {
    logDir = null;
  }
  const child = spawnBackend(canvasRoot(), process.env, nodeBinary());
  let stdoutPending = "";
  let stderrPending = "";
  let stderrAll = "";
  let opened = false;

  const takeStdout = (chunk: string, flush: boolean): void => {
    const consumed = consumeLines(stdoutPending, chunk);
    stdoutPending = flush ? "" : consumed.pending;
    const lines = flush && consumed.pending.length > 0 ? [...consumed.lines, consumed.pending] : consumed.lines;
    for (const line of lines) {
      const parsed = parseFragmentAddress(line);
      if (parsed !== null) {
        sessionToken = parsed.token;
        note(line);
        if (!opened) {
          opened = true;
          openPage(parsed.url, child);
        }
      } else if (line.length > 0) {
        note(line);
      }
    }
  };

  const takeStderr = (chunk: string, flush: boolean): void => {
    const consumed = consumeLines(stderrPending, chunk);
    stderrPending = flush ? "" : consumed.pending;
    const lines = flush && consumed.pending.length > 0 ? [...consumed.lines, consumed.pending] : consumed.lines;
    for (const line of lines) {
      if (line.length > 0) {
        stderrAll += `${line}\n`;
        note(line);
      }
    }
  };

  child.stdout?.setEncoding("utf8");
  child.stderr?.setEncoding("utf8");
  child.stdout?.on("data", (chunk: string) => {
    takeStdout(chunk, false);
  });
  child.stderr?.on("data", (chunk: string) => {
    takeStderr(chunk, false);
  });
  child.on("error", (err: Error) => {
    dialog.showErrorBox("画布", `没能启动本机后端。${err.message}`);
    app.quit();
  });
  child.on("exit", () => {
    takeStdout("", true);
    takeStderr("", true);
    if (opened || win !== null) {
      return;
    }
    void attachOrExplain(child, stderrAll);
  });
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (win === null) {
      return;
    }
    if (win.isMinimized()) {
      win.restore();
    }
    win.focus();
  });
  app.whenReady()
    .then(() => {
      start();
    })
    .catch((err: unknown) => {
      const message = err instanceof Error ? err.message : "本机服务没连上。";
      dialog.showErrorBox("画布", message);
      app.quit();
    });
  app.on("window-all-closed", () => {
    app.quit();
  });
}
