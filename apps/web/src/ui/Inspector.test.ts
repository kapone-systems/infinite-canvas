import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { USER_FACING } from "@canvas/schema";

const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "Inspector.tsx"), "utf8");

test("ThisRunButton 仅 generation；变体张数不走 setParams；有 lastPlan 任务条", () => {
  assert.equal(src.includes('single.kind === "text"'), false);
  assert.equal(src.includes('single?.kind === "generation"'), true);
  assert.equal(src.includes("data-variant-count"), true);
  assert.equal(src.includes("onVariantCountChange"), true);
  assert.equal(src.includes("data-last-plan"), true);
  assert.equal(src.includes("data-retry-failed"), true);
  assert.equal(src.includes("COPY.retryFailed"), true);
  assert.equal(src.includes("COPY.variantCountLabel"), true);
  assert.equal(src.includes("plan-skip"), true);
  assert.equal(src.includes("plan-error"), true);
  assert.equal(src.includes("data-source-line"), true);
  assert.equal(src.includes("data-version-id"), true);
  assert.equal(src.includes("KSampler"), false);
  assert.equal(src.includes("VAE"), false);
  assert.equal(src.includes("Checkpoint"), false);
  assert.equal(src.includes("CLIP"), false);
});

test("planRowClass 新鲜 skip 中性、缺槽错误", () => {
  assert.equal(src.includes('skipReason === "fresh"'), true);
  assert.equal(src.includes('return "plan-skip"'), true);
  assert.equal(src.includes('return "plan-error"'), true);
  assert.equal(USER_FACING.runSkippedFresh, "当前结果还没过期，这次跳过。");
});
