import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { USER_FACING } from "@canvas/schema";
import { projectFilePath } from "../project/atomicWrite.ts";
import { createProject, startTestApp, stopTestApp } from "./testApp.ts";

test("尚未打开时 GET /api/projects/current 为 404", async () => {
  const app = await startTestApp();
  try {
    const res = await fetch(`${app.baseUrl}/api/projects/current`, {
      headers: { Authorization: `Bearer ${app.token}` },
    });
    assert.equal(res.status, 404);
    const body = (await res.json()) as { message: string };
    assert.equal(body.message, USER_FACING.noProject);
  } finally {
    await stopTestApp(app);
  }
});

test("POST /api/projects 成功 201 并写出空 canvas.project.json；GET current 返回工作副本", async () => {
  const app = await startTestApp();
  try {
    const created = await createProject(app, "空工程");
    assert.equal(created.status, 201);
    assert.equal(typeof created.body.projectId, "string");
    assert.equal(created.body.name, "空工程");
    assert.equal(typeof created.body.absolutePath, "string");
    const project = created.body.project as Record<string, unknown>;
    assert.equal(project.format, "canvas-project");
    assert.equal(project.schemaVersion, 1);
    assert.equal("absolutePath" in project, false);

    const filePath = projectFilePath(created.body.absolutePath as string);
    const onDisk = JSON.parse(await readFile(filePath, "utf8")) as Record<string, unknown>;
    assert.equal("absolutePath" in onDisk, false);
    assert.equal(onDisk.schemaVersion, 1);
    assert.deepEqual(onDisk.nodes, {});
    const serialized = JSON.stringify(onDisk);
    assert.equal(serialized.includes("absolutePath"), false);
    assert.doesNotMatch(serialized, /[A-Za-z]:[\\/]/);

    const current = await fetch(`${app.baseUrl}/api/projects/current`, {
      headers: { Authorization: `Bearer ${app.token}` },
    });
    assert.equal(current.status, 200);
    const body = (await current.json()) as {
      project: { projectId: string };
      dirty: boolean;
      absolutePath: string;
    };
    assert.equal(body.dirty, false);
    assert.equal(body.absolutePath, created.body.absolutePath);
    assert.equal(body.project.projectId, created.body.projectId);
    assert.equal("absolutePath" in body.project, false);
  } finally {
    await stopTestApp(app);
  }
});
