import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { USER_FACING } from "@canvas/schema";
import { BACKEND_MESSAGES } from "../messages.ts";
import { projectFilePath } from "../project/atomicWrite.ts";
import { createProject, headers, startTestApp, stopTestApp, textNode } from "./testApp.ts";

test("POST /api/projects/open 路径不存在时 404、不打开、不建内存工程", async () => {
  const app = await startTestApp();
  try {
    const missing = join(app.projectsDir, "no-such-folder");
    const res = await fetch(`${app.baseUrl}/api/projects/open`, {
      method: "POST",
      headers: headers(app.origin),
      body: JSON.stringify({ absolutePath: missing }),
    });
    assert.equal(res.status, 404);
    const body = (await res.json()) as { message: string };
    assert.equal(body.message, BACKEND_MESSAGES.projectPathMissing);

    const current = await fetch(`${app.baseUrl}/api/projects/current`, {
      headers: { Authorization: `Bearer ${app.token}` },
    });
    assert.equal(current.status, 404);
  } finally {
    await stopTestApp(app);
  }
});

test("已有未保存工程时打开另一路径 409，当前工程不变", async () => {
  const app = await startTestApp();
  try {
    const created = await createProject(app, "first");
    assert.equal(created.status, 201);
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

    const otherDir = join(app.projectsDir, "other");
    await mkdir(otherDir);
    await writeFile(
      projectFilePath(otherDir),
      JSON.stringify({
        format: "canvas-project",
        schemaVersion: 1,
        projectId: "other-id",
        name: "other",
        mediaHashAlgorithm: "sha256",
        contentRevision: 0,
        savedContentRevision: 0,
        nextSerial: 1,
        createdAt: "2026-09-24T00:00:00.000Z",
        updatedAt: "2026-09-24T00:00:00.000Z",
        viewport: null,
        nodes: {},
        edges: {},
        groups: {},
      }),
      "utf8",
    );

    const open = await fetch(`${app.baseUrl}/api/projects/open`, {
      method: "POST",
      headers: headers(app.origin),
      body: JSON.stringify({ absolutePath: otherDir }),
    });
    assert.equal(open.status, 409);
    const openBody = (await open.json()) as { message: string };
    assert.equal(openBody.message, BACKEND_MESSAGES.unsavedProjectOpen);

    const current = await fetch(`${app.baseUrl}/api/projects/current`, {
      headers: { Authorization: `Bearer ${app.token}` },
    });
    const currentBody = (await current.json()) as {
      project: { name: string; nodes: Record<string, unknown> };
      dirty: boolean;
    };
    assert.equal(current.status, 200);
    assert.equal(currentBody.dirty, true);
    assert.equal(currentBody.project.name, "first");
    assert.ok(currentBody.project.nodes.n1);
  } finally {
    await stopTestApp(app);
  }
});

test("schemaVersion 0 太旧则 422 且不打开", async () => {
  const app = await startTestApp();
  try {
    const dir = join(app.projectsDir, "older");
    await mkdir(dir);
    await writeFile(
      projectFilePath(dir),
      JSON.stringify({
        format: "canvas-project",
        schemaVersion: 0,
        projectId: "p0",
        name: "older",
        mediaHashAlgorithm: "sha256",
        contentRevision: 0,
        savedContentRevision: 0,
        nextSerial: 1,
        createdAt: "2026-09-24T00:00:00.000Z",
        updatedAt: "2026-09-24T00:00:00.000Z",
        viewport: null,
        nodes: {},
        edges: {},
        groups: {},
      }),
      "utf8",
    );
    const res = await fetch(`${app.baseUrl}/api/projects/open`, {
      method: "POST",
      headers: headers(app.origin),
      body: JSON.stringify({ absolutePath: dir }),
    });
    assert.equal(res.status, 422);
    const body = (await res.json()) as { message: string };
    assert.equal(body.message, USER_FACING.schemaVersionUnsupported);
    assert.equal(body.message, "还不能打开这个版本的工程。");
    const current = await fetch(`${app.baseUrl}/api/projects/current`, {
      headers: { Authorization: `Bearer ${app.token}` },
    });
    assert.equal(current.status, 404);
  } finally {
    await stopTestApp(app);
  }
});

test("schemaVersion 太新则 422 且不打开", async () => {
  const app = await startTestApp();
  try {
    const dir = join(app.projectsDir, "newer");
    await mkdir(dir);
    await writeFile(
      projectFilePath(dir),
      JSON.stringify({
        format: "canvas-project",
        schemaVersion: 2,
        projectId: "p2",
        name: "newer",
        mediaHashAlgorithm: "sha256",
        contentRevision: 0,
        savedContentRevision: 0,
        nextSerial: 1,
        createdAt: "2026-09-24T00:00:00.000Z",
        updatedAt: "2026-09-24T00:00:00.000Z",
        viewport: null,
        nodes: {},
        edges: {},
        groups: {},
      }),
      "utf8",
    );
    const res = await fetch(`${app.baseUrl}/api/projects/open`, {
      method: "POST",
      headers: headers(app.origin),
      body: JSON.stringify({ absolutePath: dir }),
    });
    assert.equal(res.status, 422);
    const body = (await res.json()) as { message: string };
    assert.equal(body.message, USER_FACING.schemaVersionNewer);
    const current = await fetch(`${app.baseUrl}/api/projects/current`, {
      headers: { Authorization: `Bearer ${app.token}` },
    });
    assert.equal(current.status, 404);
  } finally {
    await stopTestApp(app);
  }
});
