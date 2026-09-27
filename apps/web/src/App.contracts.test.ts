/// <reference types="node" />
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const app = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "App.tsx"), "utf8");

test("运行此节点先 emit 再 flush 再 postRun；确认框先于乐观", () => {
  assert.equal(app.includes("store.emitRunThisNode"), true);
  assert.equal(app.includes("submitEmittedRun"), true);
  assert.equal(app.includes("postRun("), true);
  assert.equal(app.includes("/api/execution/runs"), false);
  assert.equal(app.includes("CapabilityService"), false);
  const handleStart = app.indexOf("const handleRunThis");
  assert.equal(handleStart >= 0, true);
  const handle = app.slice(handleStart, handleStart + 1800);
  const confirmAt = handle.indexOf("needsConfirm");
  const submitAt = handle.indexOf("submitEmittedRun");
  assert.equal(confirmAt >= 0, true);
  assert.equal(submitAt > confirmAt, true);
  assert.equal(app.includes("restoreRunningTasks"), true);
  assert.equal(app.includes("USER_FACING.restartUncertain"), true);
  assert.equal(app.includes("getRun("), true);
  assert.equal(app.includes("ingestMediaFile"), true);
  assert.equal(app.includes("addImportedImage"), true);
  assert.equal(app.includes("recheckComfy"), true);
  assert.equal(app.includes("absorbServerFields"), true);
  assert.equal(app.includes("createObjectURL"), false);
});
