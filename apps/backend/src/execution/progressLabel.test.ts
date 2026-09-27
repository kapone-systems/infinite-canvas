import assert from "node:assert/strict";
import { test } from "node:test";
import { USER_FACING } from "@canvas/schema";
import { filterComputeNodeName, runningProgressLabel } from "./progressLabel.ts";

test("计算节点名过滤为正在生成；主句无百分号", () => {
  assert.equal(filterComputeNodeName("KSampler"), USER_FACING.generatingLabel);
  assert.equal(filterComputeNodeName("VAE"), USER_FACING.generatingLabel);
  assert.equal(filterComputeNodeName("CLIP Text Encode"), USER_FACING.generatingLabel);
  assert.equal(filterComputeNodeName("Load Checkpoint"), USER_FACING.generatingLabel);
  assert.equal(runningProgressLabel("KSampler"), USER_FACING.generatingElapsed("…"));
  assert.equal(runningProgressLabel("KSampler").includes("%"), false);
  assert.equal(USER_FACING.generatingLabel, "正在生成");
});
