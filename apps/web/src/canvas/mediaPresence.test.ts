import assert from "node:assert/strict";
import { test } from "node:test";
import type { ProjectNode } from "@canvas/schema";
import { USER_FACING } from "@canvas/schema";
import { COPY } from "../ui/copy.ts";
import { mediaMissingPath, mediaMissingPrimary } from "./mediaPresence.ts";

test("缺失媒体主句是方案原文，次句只认正斜杠相对路径", () => {
  const path = "media/blobs/ab/" + "ab".repeat(32) + ".blob";
  const node = {
    output: { relativePath: path },
  } as ProjectNode;
  assert.equal(mediaMissingPrimary(), "找不到原来的媒体文件");
  assert.equal(COPY.mediaMissing, USER_FACING.mediaMissing);
  assert.equal(mediaMissingPath(node, new Set([path])), path);
  assert.equal(mediaMissingPath(node, new Set()), null);
  assert.equal(path.includes("\\"), false);
});
