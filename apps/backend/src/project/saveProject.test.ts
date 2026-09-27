import assert from "node:assert/strict";
import { chmod, readFile, writeFile } from "node:fs/promises";
import { test } from "node:test";
import { USER_FACING } from "@canvas/schema";
import { projectFilePath } from "./atomicWrite.ts";
import { createProject, headers, startTestApp, stopTestApp, textNode } from "../http/testApp.ts";

test("保存拒绝 apiKey 且磁盘不变", async () => {
  const app = await startTestApp();
  try {
    const created = await createProject(app, "secret-save");
    const dir = created.body.absolutePath as string;
    const before = await readFile(projectFilePath(dir), "utf8");

    const withKey = await fetch(`${app.baseUrl}/api/projects/current`, {
      method: "PUT",
      headers: headers(app.origin),
      body: JSON.stringify({ apiKey: "x", contentRevision: 0 }),
    });
    assert.equal(withKey.status, 400);
    const body = (await withKey.json()) as { message: string };
    assert.equal(body.message, USER_FACING.saveFailed);
    assert.equal(await readFile(projectFilePath(dir), "utf8"), before);

    const sessionProject = app.backend.session.current?.project as unknown as Record<string, unknown>;
    assert.ok(sessionProject);
    sessionProject.apiKey = "x";
    const injected = await fetch(`${app.baseUrl}/api/projects/current`, {
      method: "PUT",
      headers: headers(app.origin),
      body: "{}",
    });
    assert.equal(injected.status, 400);
    assert.equal(await readFile(projectFilePath(dir), "utf8"), before);
    delete sessionProject.apiKey;
  } finally {
    await stopTestApp(app);
  }
});

test("PUT 保存忽略请求体 nodes，只写服务器工作副本", async () => {
  const app = await startTestApp();
  try {
    const created = await createProject(app, "ignore-nodes");
    const dir = created.body.absolutePath as string;
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

    const save = await fetch(`${app.baseUrl}/api/projects/current`, {
      method: "PUT",
      headers: headers(app.origin),
      body: JSON.stringify({
        contentRevision: 1,
        nodes: { hack: textNode("hack", "不该出现") },
      }),
    });
    assert.equal(save.status, 200);
    const saveBody = (await save.json()) as {
      contentRevision: number;
      savedContentRevision: number;
    };
    assert.equal(saveBody.contentRevision, 1);
    assert.equal(saveBody.savedContentRevision, 1);

    const disk = JSON.parse(await readFile(projectFilePath(dir), "utf8")) as {
      nodes: Record<string, { text?: string }>;
      savedContentRevision: number;
    };
    assert.equal(disk.nodes.n1?.text, "一只纸船");
    assert.equal(disk.nodes.hack, undefined);
    assert.equal(disk.savedContentRevision, 1);
  } finally {
    await stopTestApp(app);
  }
});

test("磁盘 contentRevision 已变则 409，主句是另存为", async () => {
  const app = await startTestApp();
  try {
    const created = await createProject(app, "conflict");
    const dir = created.body.absolutePath as string;
    await fetch(`${app.baseUrl}/api/projects/current/working-copy`, {
      method: "PUT",
      headers: headers(app.origin),
      body: JSON.stringify({
        contentRevision: 0,
        nodes: { n1: textNode("n1", "未保存") },
        edges: {},
        groups: {},
      }),
    });

    const disk = JSON.parse(await readFile(projectFilePath(dir), "utf8")) as Record<string, unknown>;
    disk.contentRevision = 9;
    await writeFile(projectFilePath(dir), `${JSON.stringify(disk, null, 2)}\n`, "utf8");
    const before = await readFile(projectFilePath(dir), "utf8");

    const save = await fetch(`${app.baseUrl}/api/projects/current`, {
      method: "PUT",
      headers: headers(app.origin),
      body: "{}",
    });
    assert.equal(save.status, 409);
    const body = (await save.json()) as { message: string };
    assert.equal(body.message, USER_FACING.saveConflict);
    assert.equal(body.message, "这份工程在这次打开之后被写过。为避免覆盖，请另存为。");
    assert.equal(await readFile(projectFilePath(dir), "utf8"), before);

    const current = await fetch(`${app.baseUrl}/api/projects/current`, {
      headers: { Authorization: `Bearer ${app.token}` },
    });
    const currentBody = (await current.json()) as { dirty: boolean };
    assert.equal(currentBody.dirty, true);
  } finally {
    await stopTestApp(app);
  }
});

test("目标文件只读则保存失败、工作副本仍脏、磁盘原文不变", async () => {
  const app = await startTestApp();
  const created = await createProject(app, "readonly");
  const dir = created.body.absolutePath as string;
  const filePath = projectFilePath(dir);
  try {
    await fetch(`${app.baseUrl}/api/projects/current/working-copy`, {
      method: "PUT",
      headers: headers(app.origin),
      body: JSON.stringify({
        contentRevision: 0,
        nodes: { n1: textNode("n1", "还在") },
        edges: {},
        groups: {},
      }),
    });
    const before = await readFile(filePath, "utf8");
    await chmod(filePath, 0o444);
    const save = await fetch(`${app.baseUrl}/api/projects/current`, {
      method: "PUT",
      headers: headers(app.origin),
      body: "{}",
    });
    assert.notEqual(save.status, 200);
    const body = (await save.json()) as { message: string };
    assert.equal(body.message, USER_FACING.saveFailed);
    assert.equal(body.message, "没能保存，修改还在。");
    assert.equal(await readFile(filePath, "utf8"), before);
    const current = await fetch(`${app.baseUrl}/api/projects/current`, {
      headers: { Authorization: `Bearer ${app.token}` },
    });
    const currentBody = (await current.json()) as {
      dirty: boolean;
      project: { nodes: { n1?: { text?: string } } };
    };
    assert.equal(currentBody.dirty, true);
    assert.equal(currentBody.project.nodes.n1?.text, "还在");
  } finally {
    try {
      await chmod(filePath, 0o666);
    } catch {
      /* ignore */
    }
    await stopTestApp(app);
  }
});

test("POST save-as 换新目录和新 projectId", async () => {
  const app = await startTestApp();
  try {
    const created = await createProject(app, "origin-proj");
    const oldId = created.body.projectId as string;
    const oldPath = created.body.absolutePath as string;
    await fetch(`${app.baseUrl}/api/projects/current/working-copy`, {
      method: "PUT",
      headers: headers(app.origin),
      body: JSON.stringify({
        contentRevision: 0,
        nodes: { n1: textNode("n1", "另存") },
        edges: {},
        groups: {},
      }),
    });

    const saveAs = await fetch(`${app.baseUrl}/api/projects/current/save-as`, {
      method: "POST",
      headers: headers(app.origin),
      body: JSON.stringify({ parentDir: app.projectsDir, name: "copied-proj" }),
    });
    assert.equal(saveAs.status, 201);
    const body = (await saveAs.json()) as {
      projectId: string;
      name: string;
      absolutePath: string;
      project: { projectId: string; nodes: { n1?: { text?: string } } };
    };
    assert.notEqual(body.projectId, oldId);
    assert.equal(body.name, "copied-proj");
    assert.notEqual(body.absolutePath, oldPath);
    assert.equal(body.project.nodes.n1?.text, "另存");

    const oldDisk = JSON.parse(await readFile(projectFilePath(oldPath), "utf8")) as {
      projectId: string;
      nodes: Record<string, unknown>;
    };
    assert.equal(oldDisk.projectId, oldId);
    assert.deepEqual(oldDisk.nodes, {});

    const current = await fetch(`${app.baseUrl}/api/projects/current`, {
      headers: { Authorization: `Bearer ${app.token}` },
    });
    const currentBody = (await current.json()) as { dirty: boolean; absolutePath: string };
    assert.equal(currentBody.dirty, false);
    assert.equal(currentBody.absolutePath, body.absolutePath);
  } finally {
    await stopTestApp(app);
  }
});
