import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { USER_FACING } from "@canvas/schema";
import { projectFilePath } from "./atomicWrite.ts";
import { createProject, headers, startTestApp, stopTestApp } from "../http/testApp.ts";

test("PUT viewport 写入相机且不改 contentRevision、不点亮 dirty", async () => {
  const app = await startTestApp();
  try {
    const created = await createProject(app, "cam");
    const dir = created.body.absolutePath as string;
    const before = await fetch(`${app.baseUrl}/api/projects/current`, {
      headers: { Authorization: `Bearer ${app.token}` },
    });
    const beforeBody = (await before.json()) as {
      dirty: boolean;
      project: { contentRevision: number; viewport: unknown };
    };
    assert.equal(beforeBody.dirty, false);
    assert.equal(beforeBody.project.contentRevision, 0);

    const res = await fetch(`${app.baseUrl}/api/projects/current/viewport`, {
      method: "PUT",
      headers: headers(app.origin),
      body: JSON.stringify({ x: 12.5, y: -40, zoom: 1.25 }),
    });
    assert.equal(res.status, 204);

    const after = await fetch(`${app.baseUrl}/api/projects/current`, {
      headers: { Authorization: `Bearer ${app.token}` },
    });
    const afterBody = (await after.json()) as {
      dirty: boolean;
      project: { contentRevision: number; viewport: { x: number; y: number; zoom: number } };
    };
    assert.equal(afterBody.dirty, false);
    assert.equal(afterBody.project.contentRevision, 0);
    assert.deepEqual(afterBody.project.viewport, { x: 12.5, y: -40, zoom: 1.25 });

    const disk = JSON.parse(await readFile(projectFilePath(dir), "utf8")) as {
      contentRevision: number;
      savedContentRevision: number;
      viewport: { x: number; y: number; zoom: number };
    };
    assert.equal(disk.contentRevision, 0);
    assert.equal(disk.savedContentRevision, 0);
    assert.deepEqual(disk.viewport, { x: 12.5, y: -40, zoom: 1.25 });
  } finally {
    await stopTestApp(app);
  }
});

test("视口非有限数字 400，失败句固定", async () => {
  const app = await startTestApp();
  try {
    assert.equal((await createProject(app, "cam-bad")).status, 201);
    for (const body of [{ x: Infinity, y: 0, zoom: 1 }, { x: 0, y: NaN, zoom: 1 }, { x: 0, y: 0 }, "nope"]) {
      const res = await fetch(`${app.baseUrl}/api/projects/current/viewport`, {
        method: "PUT",
        headers: headers(app.origin),
        body: JSON.stringify(body),
      });
      assert.equal(res.status, 400, String(body));
      const payload = (await res.json()) as { message: string };
      assert.equal(payload.message, USER_FACING.viewportSaveFailed);
      assert.equal(payload.message, "视图没能记住，下次打开会回到默认位置");
    }
  } finally {
    await stopTestApp(app);
  }
});
