import assert from "node:assert/strict";
import { test } from "node:test";
import { createEmptyProject, USER_FACING } from "@canvas/schema";
import type { ProjectNode } from "@canvas/schema";
import { ProjectSession } from "./workingCopy.ts";

function node(overrides: Partial<ProjectNode> & { id: string }): ProjectNode {
  const { id, ...rest } = overrides;
  return {
    id,
    kind: "text",
    title: "文本 1",
    x: 0,
    y: 0,
    width: 280,
    height: 180,
    z: 0,
    groupId: null,
    origin: "authored",
    createdAt: "2026-09-24T00:00:00.000Z",
    updatedAt: "2026-09-24T00:00:00.000Z",
    outputRevision: 1,
    text: "原文",
    phase: "idle",
    executionRevision: 0,
    ...rest,
  };
}

test("session.applyWorkingCopy 合并后 queued 仍在，contentRevision +1", () => {
  const session = new ProjectSession({ now: () => new Date("2026-09-24T12:00:00.000Z") });
  const project = createEmptyProject({
    projectId: "p",
    name: "n",
    now: new Date("2026-09-24T00:00:00.000Z"),
  });
  project.nodes.n1 = node({
    id: "n1",
    phase: "queued",
    lastRunId: "run-1",
    executionRevision: 4,
    progress: { ratio: null, label: "排队" },
  });
  project.contentRevision = 2;
  session.setCurrent({
    absolutePath: "C:\\tmp\\proj",
    project,
    openedDiskContentRevision: 0,
    restoredFromAutosave: false,
  });

  const result = session.applyWorkingCopy({
    contentRevision: 2,
    nodes: {
      n1: node({ id: "n1", phase: "idle", text: "新", lastRunId: "x", executionRevision: 0 }),
    },
    edges: {},
    groups: {},
  });
  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }
  assert.equal(result.project.contentRevision, 3);
  assert.equal(result.project.nodes.n1?.phase, "queued");
  assert.equal(result.project.nodes.n1?.lastRunId, "run-1");
  assert.equal(result.project.nodes.n1?.text, "新");
  assert.equal(session.isDirty(), true);
});

test("修订冲突返回 409 主句", () => {
  const session = new ProjectSession();
  const project = createEmptyProject({ projectId: "p", name: "n" });
  session.setCurrent({
    absolutePath: "C:\\tmp\\proj",
    project,
    openedDiskContentRevision: 0,
    restoredFromAutosave: false,
  });
  const result = session.applyWorkingCopy({
    contentRevision: 9,
    nodes: {},
    edges: {},
    groups: {},
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.httpStatus, 409);
    assert.equal(result.message, USER_FACING.workingCopySyncFailed);
  }
});
