import assert from "node:assert/strict";
import { test } from "node:test";
import { generationBadge, userBadge, userBadgeLabel } from "./generationBadge.ts";
import type { ProjectNode, ResultVersion, Variant } from "./types.ts";
import { USER_FACING } from "./userFacingMessages.ts";

function variant(phase: Variant["phase"], id = "v0"): Variant {
  return {
    id,
    index: 0,
    phase,
    seedUsed: phase === "succeeded" ? 1 : null,
    output:
      phase === "succeeded"
        ? {
            kind: "image",
            relativePath: "media/blobs/aa/aa.blob",
            contentHash: "aa".repeat(32),
            byteSize: 1,
            mimeDetected: "image/png",
            width: 8,
            height: 8,
            durationMs: null,
            firstFrameRelativePath: null,
            lastFrameRelativePath: null,
            coverRelativePath: null,
            proxyRelativePath: null,
            thumbRelativePath: null,
          }
        : null,
    text: null,
    error: phase === "failed" ? { code: "GEN", message: USER_FACING.generationFailedNoDetail } : null,
    createdAt: "2026-09-24T00:00:00.000Z",
  };
}

function version(variants: Variant[]): ResultVersion {
  return {
    id: "ver",
    createdAt: "2026-09-24T00:00:00.000Z",
    fingerprint: "fp-success",
    recipeId: "recipe.image.txt2img.fictional",
    recipeVersion: 1,
    paramSnapshot: {},
    variantCountRequested: variants.length,
    variants,
  };
}

function gen(overrides: Partial<ProjectNode> = {}): ProjectNode {
  return {
    id: "g",
    kind: "generation",
    title: "文生图",
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
    freshness: "fresh",
    ...overrides,
  };
}

test("徽章六态：排队/运行优先；有成功且指纹不符为过期", () => {
  assert.equal(generationBadge(gen({ phase: "queued" })), "queued");
  assert.equal(generationBadge(gen({ phase: "running" })), "running");
  assert.equal(generationBadge(gen({ phase: "idle" })), "empty");
  assert.equal(generationBadge(gen({ phase: "failed" })), "failed");

  const success = gen({
    phase: "idle",
    freshness: "fresh",
    versions: [version([variant("succeeded")])],
    lastSuccessFingerprint: "fp-success",
    lastAttemptFingerprint: "fp-success",
  });
  assert.equal(generationBadge(success, "fp-success"), "succeeded");
  assert.equal(userBadge(success, "fp-other"), "stale");
  assert.equal(userBadgeLabel("stale"), "过期");
  assert.equal(userBadgeLabel("empty"), "空");
  assert.equal(userBadgeLabel("queued"), "排队");
  assert.equal(userBadgeLabel("running"), "运行");
  assert.equal(userBadgeLabel("succeeded"), "成功");
  assert.equal(userBadgeLabel("failed"), "失败");
});

test("有成功版本不能只看 phase=idle 当成空；最近失败且指纹仍符为失败", () => {
  const node = gen({
    phase: "idle",
    freshness: "fresh",
    versions: [version([variant("succeeded")])],
    lastSuccessFingerprint: "fp-success",
  });
  assert.equal(generationBadge(node, "fp-success"), "succeeded");
  assert.notEqual(generationBadge(node, "fp-success"), "empty");

  const failedRetry = gen({
    phase: "failed",
    freshness: "fresh",
    versions: [version([variant("succeeded")])],
    lastSuccessFingerprint: "fp-success",
    lastAttemptFingerprint: "fp-success",
  });
  assert.equal(generationBadge(failedRetry, "fp-success"), "failed");
});
