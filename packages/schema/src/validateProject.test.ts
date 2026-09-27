import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { createEmptyProject } from "./createEmptyProject.ts";
import { TEXT_MAX_CHARS } from "./textLimit.ts";
import type { CanvasProjectFile, MediaRef, ProjectNode } from "./types.ts";
import { USER_FACING } from "./userFacingMessages.ts";
import { validateProject } from "./validateProject.ts";

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), "../fixtures");

function readFixture(name: string): unknown {
  return JSON.parse(readFileSync(join(fixturesDir, name), "utf8"));
}

function mediaRef(relativePath: string): MediaRef {
  return {
    kind: "image",
    relativePath,
    contentHash: null,
    byteSize: null,
    mimeDetected: null,
    width: null,
    height: null,
    durationMs: null,
    firstFrameRelativePath: null,
    lastFrameRelativePath: null,
    coverRelativePath: null,
    proxyRelativePath: null,
    thumbRelativePath: null,
  };
}

function textNode(id: string, text: string): ProjectNode {
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
    text,
  };
}

function withImagePath(relativePath: string): CanvasProjectFile {
  const project = createEmptyProject({
    projectId: "proj-path",
    name: "路径",
    now: new Date("2026-09-24T00:00:00.000Z"),
  });
  project.nodes["img-1"] = {
    id: "img-1",
    kind: "image",
    title: "图",
    x: 0,
    y: 0,
    width: 280,
    height: 80,
    z: 0,
    groupId: null,
    origin: "imported",
    createdAt: "2026-09-24T00:00:00.000Z",
    updatedAt: "2026-09-24T00:00:00.000Z",
    outputRevision: 1,
    output: mediaRef(relativePath),
  };
  return project;
}

test("valid-empty 夹具与 createEmptyProject 可通过校验", () => {
  const fixture = validateProject(readFixture("valid-empty.json"));
  assert.equal(fixture.ok, true);
  const created = validateProject(
    createEmptyProject({ projectId: "p1", name: "新建", now: new Date("2026-09-24T00:00:00.000Z") }),
  );
  assert.equal(created.ok, true);
  if (created.ok) {
    assert.equal(created.project.schemaVersion, 1);
    assert.equal(created.project.format, "canvas-project");
    assert.equal(created.project.contentRevision, 0);
    assert.equal(created.project.savedContentRevision, 0);
    assert.equal("absolutePath" in created.project, false);
  }
});

test("schemaVersion 2 拒打开，422 主句是更新版本", () => {
  const result = validateProject(readFixture("schema-version-2.json"));
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.httpStatus, 422);
    assert.equal(result.message, USER_FACING.schemaVersionNewer);
    assert.equal(
      result.message,
      "这份工程是更新的版本写的，画布没有打开它，以免写坏。",
    );
  }
});

test("schemaVersion 0 拒打开，422 主句是还不能打开这个版本", () => {
  const raw = readFixture("valid-empty.json");
  assert.ok(raw !== null && typeof raw === "object");
  const copy = { ...(raw as Record<string, unknown>), schemaVersion: 0 };
  const result = validateProject(copy);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.httpStatus, 422);
    assert.equal(result.message, USER_FACING.schemaVersionUnsupported);
    assert.equal(result.message, "还不能打开这个版本的工程。");
  }
});

test("schemaVersion 缺失拒打开，422 主句是还不能打开这个版本", () => {
  const raw = readFixture("valid-empty.json");
  assert.ok(raw !== null && typeof raw === "object");
  const copy = { ...(raw as Record<string, unknown>) };
  delete copy.schemaVersion;
  const result = validateProject(copy);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.httpStatus, 422);
    assert.equal(result.message, USER_FACING.schemaVersionUnsupported);
    assert.equal(result.message, "还不能打开这个版本的工程。");
  }
});

test("密钥键名拒存", () => {
  const result = validateProject(readFixture("secret-apikey.json"));
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.httpStatus, 400);
    assert.equal(result.code, "forbidden_key");
  }
});

test("data: 前缀拒绝整次写入", () => {
  const project = createEmptyProject({ projectId: "p-data", name: "data" });
  project.nodes["n1"] = textNode("n1", "data:image/png;base64,aaaa");
  const result = validateProject(project);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.code, "data_uri");
    assert.equal(result.httpStatus, 400);
  }
});

test("非法工程路径拒存", () => {
  const cases = [
    "C:/foo/bar.png",
    "foo\\bar.png",
    "/abs/media.png",
    "media/blobs/../x.blob",
  ];
  for (const relativePath of cases) {
    const result = validateProject(withImagePath(relativePath));
    assert.equal(result.ok, false, relativePath);
    if (!result.ok) {
      assert.equal(result.code, "invalid_rel_path", relativePath);
      assert.equal(result.httpStatus, 400, relativePath);
    }
  }
  const ok = validateProject(withImagePath("media/blobs/ab/ab.blob"));
  assert.equal(ok.ok, true);
});

test("文本超过 100000 字符拒绝，主句固定", () => {
  const project = createEmptyProject({ projectId: "p-text", name: "text" });
  project.nodes["n1"] = textNode("n1", "汉".repeat(TEXT_MAX_CHARS + 1));
  const result = validateProject(project);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.httpStatus, 400);
    assert.equal(result.message, "文本太长，没有放进节点。");
  }
  const allowed = createEmptyProject({ projectId: "p-text-ok", name: "text" });
  allowed.nodes["n1"] = textNode("n1", "汉".repeat(TEXT_MAX_CHARS));
  assert.equal(validateProject(allowed).ok, true);
});

test("落盘工程不得含 absolutePath", () => {
  const raw = readFixture("valid-empty.json");
  const withAbs = {
    ...(raw as Record<string, unknown>),
    absolutePath: "C:/tmp/project",
  };
  const result = validateProject(withAbs);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.code, "absolute_path");
  }
});
