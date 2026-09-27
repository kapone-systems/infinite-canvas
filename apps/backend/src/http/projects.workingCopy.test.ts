import assert from "node:assert/strict";
import { test } from "node:test";
import { USER_FACING } from "@canvas/schema";
import { createProject, headers, startTestApp, stopTestApp, textNode } from "./testApp.ts";

async function readWorkingCopyOk(res: Response): Promise<{
  contentRevision: number;
  executionRevisions?: Record<string, number>;
}> {
  assert.equal(res.status, 204);
  const headerRev = res.headers.get("X-Content-Revision");
  assert.ok(headerRev);
  let fromBody: { contentRevision?: number; executionRevisions?: Record<string, number> } | undefined;
  const text = await res.text();
  if (text.length > 0) {
    try {
      fromBody = JSON.parse(text) as { contentRevision?: number; executionRevisions?: Record<string, number> };
    } catch {
      fromBody = undefined;
    }
  }
  const contentRevision = fromBody?.contentRevision ?? Number(headerRev);
  assert.equal(Number.isFinite(contentRevision), true);
  const execHeader = res.headers.get("X-Execution-Revisions");
  let executionRevisions = fromBody?.executionRevisions;
  if (executionRevisions === undefined && execHeader !== null && execHeader.length > 0) {
    executionRevisions = JSON.parse(execHeader) as Record<string, number>;
  }
  return { contentRevision, executionRevisions };
}

test("PUT working-copy 按合并规则成功 204，修订在正文或 X-Content-Revision；修订不等 409；不变量 400", async () => {
  const app = await startTestApp();
  try {
    const created = await createProject(app, "merge-http");
    assert.equal(created.status, 201);

    const ok = await fetch(`${app.baseUrl}/api/projects/current/working-copy`, {
      method: "PUT",
      headers: headers(app.origin),
      body: JSON.stringify({
        contentRevision: 0,
        nodes: { n1: textNode("n1", "一只纸船") },
        edges: {},
        groups: {},
      }),
    });
    assert.equal(ok.status, 204);
    const okBody = await readWorkingCopyOk(ok);
    assert.equal(okBody.contentRevision, 1);
    assert.equal(okBody.executionRevisions?.n1, 0);

    const current = await fetch(`${app.baseUrl}/api/projects/current`, {
      headers: { Authorization: `Bearer ${app.token}` },
    });
    const currentBody = (await current.json()) as {
      dirty: boolean;
      project: { contentRevision: number; nodes: { n1?: { text?: string; phase?: string } } };
    };
    assert.equal(currentBody.dirty, true);
    assert.equal(currentBody.project.contentRevision, 1);
    assert.equal(currentBody.project.nodes.n1?.text, "一只纸船");

    const conflict = await fetch(`${app.baseUrl}/api/projects/current/working-copy`, {
      method: "PUT",
      headers: headers(app.origin),
      body: JSON.stringify({
        contentRevision: 0,
        nodes: { n1: textNode("n1", "不该写进去") },
        edges: {},
        groups: {},
      }),
    });
    assert.equal(conflict.status, 409);
    const conflictBody = (await conflict.json()) as { message: string };
    assert.equal(conflictBody.message, USER_FACING.workingCopySyncFailed);

    const afterConflict = await fetch(`${app.baseUrl}/api/projects/current`, {
      headers: { Authorization: `Bearer ${app.token}` },
    });
    const afterBody = (await afterConflict.json()) as {
      project: { nodes: { n1?: { text?: string } } };
    };
    assert.equal(afterBody.project.nodes.n1?.text, "一只纸船");

    const invariant = await fetch(`${app.baseUrl}/api/projects/current/working-copy`, {
      method: "PUT",
      headers: headers(app.origin),
      body: JSON.stringify({ contentRevision: 1, nodes: [], edges: {}, groups: {} }),
    });
    assert.equal(invariant.status, 400);
    const invBody = (await invariant.json()) as { message: string };
    assert.equal(invBody.message, USER_FACING.workingCopySyncFailed);
  } finally {
    await stopTestApp(app);
  }
});

test("假 phase=queued 不得被客户端 PUT 清掉", async () => {
  const app = await startTestApp();
  try {
    assert.equal((await createProject(app, "queued")).status, 201);
    const put = await fetch(`${app.baseUrl}/api/projects/current/working-copy`, {
      method: "PUT",
      headers: headers(app.origin),
      body: JSON.stringify({
        contentRevision: 0,
        nodes: {
          n1: textNode("n1", "原文", {
            phase: "idle",
            lastRunId: "run-1",
            executionRevision: 3,
          }),
        },
        edges: {},
        groups: {},
      }),
    });
    assert.equal(put.status, 204);

    const node = app.backend.session.current?.project.nodes.n1;
    assert.ok(node);
    node.phase = "queued";
    node.lastRunId = "run-1";
    node.executionRevision = 7;
    node.progress = { ratio: 0.2, label: "排队" };

    const cover = await fetch(`${app.baseUrl}/api/projects/current/working-copy`, {
      method: "PUT",
      headers: headers(app.origin),
      body: JSON.stringify({
        contentRevision: 1,
        nodes: {
          n1: textNode("n1", "改过的字", {
            phase: "idle",
            lastRunId: "hack",
            executionRevision: 0,
            x: 40,
          }),
        },
        edges: {},
        groups: {},
      }),
    });
    assert.equal(cover.status, 204);
    const merged = app.backend.session.current?.project.nodes.n1;
    assert.ok(merged);
    assert.equal(merged.phase, "queued");
    assert.equal(merged.lastRunId, "run-1");
    assert.equal(merged.executionRevision, 7);
    assert.equal(merged.text, "改过的字");
    assert.equal(merged.x, 40);
  } finally {
    await stopTestApp(app);
  }
});
