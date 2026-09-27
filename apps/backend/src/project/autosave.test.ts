import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { createEmptyProject, USER_FACING } from "@canvas/schema";
import {
  projectAutosavePath,
  projectFilePath,
} from "./atomicWrite.ts";
import { isAutosaveNewer } from "./autosave.ts";
import { AUTOSAVE_DELAY_MS } from "./workingCopy.ts";
import { createProject, headers, startTestApp, stopTestApp, textNode } from "../http/testApp.ts";

test("结构编辑距上次内容修订默认 1 秒", () => {
  assert.equal(AUTOSAVE_DELAY_MS, 1000);
});

test("防抖后写入 autosave 且不改 savedContentRevision / 正式文件", async () => {
  const app = await startTestApp({ autosaveDelayMs: 40 });
  try {
    const created = await createProject(app, "autosave-demo");
    assert.equal(created.status, 201);
    const dir = created.body.absolutePath as string;
    const officialBefore = await readFile(projectFilePath(dir), "utf8");

    const put = await fetch(`${app.baseUrl}/api/projects/current/working-copy`, {
      method: "PUT",
      headers: headers(app.origin),
      body: JSON.stringify({
        contentRevision: 0,
        nodes: { n1: textNode("n1", "一只纸船") },
        edges: {},
        groups: {},
      }),
    });
    assert.equal(put.status, 204);

    let autosaveNow = true;
    try {
      await readFile(projectAutosavePath(dir), "utf8");
    } catch {
      autosaveNow = false;
    }
    assert.equal(autosaveNow, false);

    await delay(80);
    const autosaveText = await readFile(projectAutosavePath(dir), "utf8");
    const autosave = JSON.parse(autosaveText) as {
      contentRevision: number;
      savedContentRevision: number;
      nodes: { n1?: { text?: string } };
    };
    assert.equal(autosave.contentRevision, 1);
    assert.equal(autosave.savedContentRevision, 0);
    assert.equal(autosave.nodes.n1?.text, "一只纸船");
    assert.equal("absolutePath" in autosave, false);

    const officialAfter = await readFile(projectFilePath(dir), "utf8");
    assert.equal(officialAfter, officialBefore);
    const official = JSON.parse(officialAfter) as { savedContentRevision: number; contentRevision: number };
    assert.equal(official.savedContentRevision, 0);
    assert.equal(official.contentRevision, 0);
  } finally {
    await stopTestApp(app);
  }
});

test("打开时更新的合法 autosave 载入并标脏「已从自动保存恢复。」", async () => {
  const app = await startTestApp({ autosaveDelayMs: 30 });
  try {
    const created = await createProject(app, "restore-demo");
    const dir = created.body.absolutePath as string;
    const put = await fetch(`${app.baseUrl}/api/projects/current/working-copy`, {
      method: "PUT",
      headers: headers(app.origin),
      body: JSON.stringify({
        contentRevision: 0,
        nodes: { n1: textNode("n1", "恢复正文") },
        edges: {},
        groups: {},
      }),
    });
    assert.equal(put.status, 204);
    const flushed = await app.backend.session.flushAutosave();
    assert.equal(flushed?.ok, true);

    app.backend.session.clear();
    const opened = await fetch(`${app.baseUrl}/api/projects/open`, {
      method: "POST",
      headers: headers(app.origin),
      body: JSON.stringify({ absolutePath: dir }),
    });
    assert.equal(opened.status, 200);
    const body = (await opened.json()) as {
      dirty: boolean;
      message?: string;
      project: { contentRevision: number; savedContentRevision: number; nodes: { n1?: { text?: string } } };
    };
    assert.equal(body.dirty, true);
    assert.equal(body.message, USER_FACING.restoredFromAutosave);
    assert.equal(body.message, "已从自动保存恢复。");
    assert.equal(body.project.nodes.n1?.text, "恢复正文");
    assert.equal(body.project.contentRevision, 1);
    assert.equal(body.project.savedContentRevision, 0);
  } finally {
    await stopTestApp(app);
  }
});

test("autosave 失败不改磁盘且返回可供界面展示的失败", async () => {
  const app = await startTestApp();
  try {
    const created = await createProject(app, "fail-auto");
    const dir = created.body.absolutePath as string;
    const officialBefore = await readFile(projectFilePath(dir), "utf8");
    await mkdir(projectAutosavePath(dir));

    const put = await fetch(`${app.baseUrl}/api/projects/current/working-copy`, {
      method: "PUT",
      headers: headers(app.origin),
      body: JSON.stringify({
        contentRevision: 0,
        nodes: { n1: textNode("n1", "还在页面上") },
        edges: {},
        groups: {},
      }),
    });
    assert.equal(put.status, 204);
    const result = await app.backend.session.flushAutosave();
    assert.equal(result?.ok, false);
    if (result && !result.ok) {
      assert.equal(result.message, USER_FACING.autosaveFailed);
    }
    assert.equal(await readFile(projectFilePath(dir), "utf8"), officialBefore);

    const current = await fetch(`${app.baseUrl}/api/projects/current`, {
      headers: { Authorization: `Bearer ${app.token}` },
    });
    const currentBody = (await current.json()) as {
      dirty: boolean;
      autosaveError?: { message: string };
    };
    assert.equal(currentBody.dirty, true);
    assert.equal(currentBody.autosaveError?.message, USER_FACING.autosaveFailed);
  } finally {
    await stopTestApp(app);
  }
});

test("isAutosaveNewer：更高 contentRevision 视为更新", () => {
  const official = createEmptyProject({ projectId: "a", name: "a" });
  const autosave = createEmptyProject({ projectId: "a", name: "a" });
  autosave.contentRevision = 1;
  assert.equal(
    isAutosaveNewer({
      official,
      officialMtimeMs: 100,
      autosave,
      autosaveMtimeMs: 1,
    }),
    true,
  );
});

