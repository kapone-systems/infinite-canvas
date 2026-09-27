import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  isDiskRoot,
  isForbiddenProjectFolder,
  projectDirFromParent,
} from "./forbiddenLocations.ts";
import { isValidWindowsFolderName } from "./windowsName.ts";
import { BACKEND_MESSAGES } from "../messages.ts";
import { createProject, headers, startTestApp, stopTestApp } from "../http/testApp.ts";

test("磁盘根、用户主目录、应用数据目录及其子路径禁止当工程文件夹", () => {
  const home = join(tmpdir(), "canvas-home-user");
  const appData = join(tmpdir(), "canvas-appdata-dir");
  const ctx = { home, appData };

  if (process.platform === "win32") {
    assert.equal(isDiskRoot("C:\\"), true);
    assert.equal(isDiskRoot("C:/"), true);
    assert.equal(isDiskRoot("C:\\Users\\someone"), false);
  } else {
    assert.equal(isDiskRoot("/"), true);
    assert.equal(isDiskRoot("/home"), false);
  }

  assert.equal(isForbiddenProjectFolder(home, ctx), true);
  assert.equal(isForbiddenProjectFolder(appData, ctx), true);
  assert.equal(isForbiddenProjectFolder(join(appData, "inside"), ctx), true);
  assert.equal(isForbiddenProjectFolder(join(home, "ok-project"), ctx), false);
  assert.equal(isForbiddenProjectFolder(join(tmpdir(), "projects", "demo"), ctx), false);
});

test("Windows 工程名过滤", () => {
  assert.equal(isValidWindowsFolderName("空工程"), true);
  assert.equal(isValidWindowsFolderName("demo"), true);
  assert.equal(isValidWindowsFolderName(""), false);
  assert.equal(isValidWindowsFolderName("CON"), false);
  assert.equal(isValidWindowsFolderName("nul.txt"), false);
  assert.equal(isValidWindowsFolderName("a<b"), false);
  assert.equal(isValidWindowsFolderName("foo."), false);
  assert.equal(isValidWindowsFolderName("a/b"), false);
  assert.equal(isValidWindowsFolderName(".."), false);
});

test("HTTP 拒绝把工程建在应用数据目录里", async () => {
  const app = await startTestApp();
  try {
    const res = await fetch(`${app.baseUrl}/api/projects`, {
      method: "POST",
      headers: headers(app.origin),
      body: JSON.stringify({ parentDir: app.dataDir, name: "inside-appdata" }),
    });
    assert.equal(res.status, 400);
    const body = (await res.json()) as { message: string };
    assert.equal(body.message, BACKEND_MESSAGES.forbiddenProjectLocation);

    const created = await createProject(app, "ok-name");
    assert.equal(created.status, 201);

    const badName = await fetch(`${app.baseUrl}/api/projects`, {
      method: "POST",
      headers: headers(app.origin),
      body: JSON.stringify({ parentDir: app.projectsDir, name: "CON" }),
    });
    assert.equal(badName.status, 400);

    const dup = await fetch(`${app.baseUrl}/api/projects`, {
      method: "POST",
      headers: headers(app.origin),
      body: JSON.stringify({ parentDir: app.projectsDir, name: "ok-name" }),
    });
    assert.equal(dup.status, 409);
    assert.equal(projectDirFromParent(app.projectsDir, "ok-name").length > 0, true);
  } finally {
    await stopTestApp(app);
  }
});
