/// <reference types="node" />
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const src = readFileSync(join(process.cwd(), "apps/web/src/canvas/GenerationNode.tsx"), "utf8");

test("有输出但无缩略图走 ThumbFailed，不是空预览句", () => {
  assert.equal(src.includes("ThumbFailed"), true);
  assert.equal(src.includes("props.node.output != null"), true);
  assert.equal(src.includes("<ThumbFailed"), true);
  const failedAt = src.indexOf("<ThumbFailed");
  const emptyAt = src.indexOf("emptyGenerationPreview");
  assert.equal(failedAt >= 0 && emptyAt > failedAt, true);
});
