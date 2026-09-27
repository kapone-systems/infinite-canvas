import assert from "node:assert/strict";
import { test } from "node:test";
import { blobRelPath, isValidProjectRelPath } from "./projectRelPath.ts";

test("合法正斜杠相对路径通过", () => {
  assert.equal(isValidProjectRelPath("media/blobs/ab/abcd.blob"), true);
  assert.equal(isValidProjectRelPath("media/derived/ab/thumb.webp"), true);
  assert.equal(isValidProjectRelPath("canvas.project.json"), true);
});

test("盘符、绝对路径、反斜杠、以 / 开头、含 .. 均拒绝", () => {
  assert.equal(isValidProjectRelPath("C:/foo/bar"), false);
  assert.equal(isValidProjectRelPath("C:\\foo\\bar"), false);
  assert.equal(isValidProjectRelPath("D:bar"), false);
  assert.equal(isValidProjectRelPath("/media/blobs/ab/x.blob"), false);
  assert.equal(isValidProjectRelPath("foo\\bar"), false);
  assert.equal(isValidProjectRelPath("foo/../bar"), false);
  assert.equal(isValidProjectRelPath("../x"), false);
  assert.equal(isValidProjectRelPath("foo/bar/.."), false);
  assert.equal(isValidProjectRelPath("media/blobs/ab/../cd.blob"), false);
  assert.equal(isValidProjectRelPath(""), false);
});

test("blobRelPath 只产出正斜杠相对路径", () => {
  const hash = "ab".repeat(32);
  const path = blobRelPath(hash);
  assert.equal(path, `media/blobs/ab/${hash}.blob`);
  assert.equal(isValidProjectRelPath(path), true);
  assert.equal(path.includes("\\"), false);
  assert.equal(path.startsWith("/"), false);
});
