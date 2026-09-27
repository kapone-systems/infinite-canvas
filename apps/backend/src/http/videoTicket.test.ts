import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import type { MediaRef, ProjectNode } from "@canvas/schema";
import { createProject, headers, startTestApp, stopTestApp } from "./testApp.ts";

const HASH = "ab".repeat(32);
const FRAME = "cd".repeat(32);
const BLOB = `media/blobs/${HASH.slice(0, 2)}/${HASH}.blob`;
const FIRST = `media/derived/${HASH.slice(0, 2)}/${HASH}/frame-png-native-v1/${FRAME}.png`;

function videoOutput(): MediaRef {
  return {
    kind: "video",
    relativePath: BLOB,
    contentHash: HASH,
    byteSize: 8,
    mimeDetected: "video/mp4",
    width: null,
    height: null,
    durationMs: 4000,
    firstFrameRelativePath: FIRST,
    lastFrameRelativePath: null,
    coverRelativePath: null,
    proxyRelativePath: null,
    thumbRelativePath: null,
  };
}

function videoNode(): ProjectNode {
  return {
    id: "v",
    kind: "video",
    title: "视频 1",
    x: 0,
    y: 0,
    width: 320,
    height: 180,
    z: 1,
    groupId: null,
    origin: "imported",
    createdAt: "2026-09-26T00:00:00.000Z",
    updatedAt: "2026-09-26T00:00:00.000Z",
    outputRevision: 1,
    output: videoOutput(),
  };
}

test("首帧 thumb 可签发，original 403；视频原件 thumb 403，original 可签发", async () => {
  const app = await startTestApp();
  try {
    const created = await createProject(app, "tickets");
    assert.equal(created.status, 201);
    const dir = created.body.absolutePath as string;
    await mkdir(join(dir, "media", "blobs", HASH.slice(0, 2)), { recursive: true });
    await mkdir(join(dir, "media", "derived", HASH.slice(0, 2), HASH, "frame-png-native-v1"), { recursive: true });
    await writeFile(join(dir, ...BLOB.split("/")), Buffer.from("original"));
    await writeFile(join(dir, ...FIRST.split("/")), Buffer.from("frame"));
    const put = await fetch(`${app.baseUrl}/api/projects/current/working-copy`, {
      method: "PUT",
      headers: headers(app.origin),
      body: JSON.stringify({ contentRevision: 0, nodes: { v: videoNode() }, edges: {}, groups: {} }),
    });
    assert.equal(put.status, 204);
    const issue = async (relativePath: string, purpose: string): Promise<number> => {
      const res = await fetch(`${app.baseUrl}/api/projects/current/media-tickets`, {
        method: "POST",
        headers: headers(app.origin),
        body: JSON.stringify({ relativePath, purpose }),
      });
      return res.status;
    };
    assert.equal(await issue(FIRST, "thumb"), 201);
    assert.equal(await issue(FIRST, "original"), 403);
    assert.equal(await issue(BLOB, "thumb"), 403);
    assert.equal(await issue(BLOB, "original"), 201);
  } finally {
    await stopTestApp(app);
  }
});
