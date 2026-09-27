/// <reference types="node" />
import assert from "node:assert/strict";
import { test } from "node:test";
import type { ProjectNode } from "@canvas/schema";
import { USER_FACING } from "@canvas/schema";
import {
  buildRunRequest,
  nodeRunForce,
  selectionHasGeneration,
  selectionRunForce,
} from "./runRequest.ts";

function gen(id: string): ProjectNode {
  return {
    id,
    kind: "generation",
    title: id,
    x: 0,
    y: 0,
    width: 320,
    height: 240,
    z: 1,
    groupId: null,
    origin: "authored",
    createdAt: "2026-09-24T00:00:00.000Z",
    updatedAt: "2026-09-24T00:00:00.000Z",
    outputRevision: 1,
    phase: "idle",
  };
}

function text(id: string): ProjectNode {
  return {
    id,
    kind: "text",
    title: id,
    x: 0,
    y: 0,
    width: 280,
    height: 180,
    z: 1,
    groupId: null,
    origin: "authored",
    createdAt: "2026-09-24T00:00:00.000Z",
    updatedAt: "2026-09-24T00:00:00.000Z",
    outputRevision: 1,
    text: "字",
  };
}

test("downstream.force 恒 false", () => {
  const request = buildRunRequest({
    projectId: "p",
    clientRequestId: "c1",
    scope: { type: "downstream", nodeId: "n1" },
    force: true,
  });
  assert.equal(request.force, false);
  assert.equal(request.scope.type, "downstream");
  assert.deepEqual(request.scope, { type: "downstream", nodeId: "n1" });
  const node = buildRunRequest({
    projectId: "p",
    clientRequestId: "c2",
    scope: { type: "node", nodeId: "n1" },
    force: true,
  });
  assert.equal(node.force, true);
  assert.deepEqual(node.scope, { type: "node", nodeId: "n1" });
  const selection = buildRunRequest({
    projectId: "p",
    clientRequestId: "c3",
    scope: { type: "selection", nodeIds: ["n1", "n2"] },
    force: true,
  });
  assert.equal(selection.force, true);
  assert.deepEqual(selection.scope, { type: "selection", nodeIds: ["n1", "n2"] });
});

test("新鲜确认后 force true；空失败过期不确认", () => {
  const pending = nodeRunForce("succeeded", false);
  assert.equal(pending.needsConfirm, true);
  assert.equal(pending.force, false);
  assert.equal(
    pending.confirmMessage,
    "当前结果还没过期。再跑会新增一个版本，旧结果还留在版本里，不会被盖掉。",
  );
  const confirmed = nodeRunForce("succeeded", true);
  assert.equal(confirmed.force, true);
  assert.equal(nodeRunForce("stale", false).force, false);
  assert.equal(nodeRunForce("empty", false).needsConfirm, false);
  assert.equal(nodeRunForce("failed", false).needsConfirm, false);
});

test("选区至少一个生成节点即可", () => {
  assert.equal(selectionHasGeneration([gen("g1")]), true);
  assert.equal(selectionHasGeneration([text("t1")]), false);
  assert.equal(selectionHasGeneration([text("t1"), gen("g1")]), true);
  const confirm = selectionRunForce(true, false);
  assert.equal(confirm.needsConfirm, true);
  assert.equal(confirm.confirmMessage, USER_FACING.runSelectionConfirm);
  assert.equal(selectionRunForce(true, true).force, true);
  assert.equal(selectionRunForce(false, false).force, false);
});
