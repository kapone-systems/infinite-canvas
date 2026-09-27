import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import type { MediaRef, ProjectNode } from "@canvas/schema";
import { USER_FACING } from "@canvas/schema";
import { BACKEND_MESSAGES } from "../messages.ts";
import { isTokenExemptPath, redactMediaTicketPath } from "./guard.ts";
import { createProject, headers, startTestApp, stopTestApp, type TestApp } from "./testApp.ts";
import {
  FIXTURE_THUMB_BYTES,
  FIXTURE_THUMB_REL_PATH,
  FIXTURE_THUMB_SHA256,
} from "../media/fixtureThumb.ts";

const SOURCE_HASH = "a".repeat(64);
const DERIVED_HASH = "b".repeat(64);
const THUMB_REL = `media/derived/aa/${SOURCE_HASH}/thumb-webp-longedge-512-v1/${DERIVED_HASH}.webp`;
const BLOB_REL = `media/blobs/aa/${SOURCE_HASH}.blob`;
const OTHER_THUMB_REL = `media/derived/ff/${"f".repeat(64)}/thumb-webp-longedge-512-v1/${"e".repeat(64)}.webp`;
const THUMB_BYTES = Buffer.from("fixture-thumb-webp-0123456789");

function imageOutput(overrides: Partial<MediaRef> = {}): MediaRef {
  return {
    kind: "image",
    relativePath: BLOB_REL,
    contentHash: SOURCE_HASH,
    byteSize: THUMB_BYTES.length,
    mimeDetected: "image/webp",
    width: 8,
    height: 8,
    durationMs: null,
    firstFrameRelativePath: null,
    lastFrameRelativePath: null,
    coverRelativePath: null,
    proxyRelativePath: null,
    thumbRelativePath: THUMB_REL,
    ...overrides,
  };
}

function imageNode(id: string, output: MediaRef): ProjectNode {
  return {
    id,
    kind: "image",
    title: "图 1",
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
    output,
  };
}

async function writeThumbFile(projectDir: string): Promise<void> {
  const dir = join(
    projectDir,
    "media",
    "derived",
    "aa",
    SOURCE_HASH,
    "thumb-webp-longedge-512-v1",
  );
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, `${DERIVED_HASH}.webp`), THUMB_BYTES);
}

async function openProjectWithThumb(app: TestApp): Promise<string> {
  const created = await createProject(app, "ticket-demo");
  assert.equal(created.status, 201);
  const projectDir = created.body.absolutePath as string;
  await writeThumbFile(projectDir);
  const put = await fetch(`${app.baseUrl}/api/projects/current/working-copy`, {
    method: "PUT",
    headers: headers(app.origin),
    body: JSON.stringify({
      contentRevision: 0,
      nodes: { img1: imageNode("img1", imageOutput()) },
      edges: {},
      groups: {},
    }),
  });
  assert.equal(put.status, 204);
  return projectDir;
}

async function issueThumbTicket(app: TestApp): Promise<{ ticketId: string; expiresAt: string }> {
  const res = await fetch(`${app.baseUrl}/api/projects/current/media-tickets`, {
    method: "POST",
    headers: headers(app.origin),
    body: JSON.stringify({ relativePath: THUMB_REL, purpose: "thumb" }),
  });
  assert.equal(res.status, 201);
  const body = (await res.json()) as { ticketId: string; expiresAt: string };
  assert.equal(typeof body.ticketId, "string");
  assert.ok(body.ticketId.length > 0);
  assert.notEqual(body.ticketId, THUMB_REL);
  assert.equal(typeof body.expiresAt, "string");
  assert.equal(Number.isNaN(Date.parse(body.expiresAt)), false);
  return body;
}

async function waitForLog(lines: string[], needle: string): Promise<void> {
  const start = Date.now();
  while (!lines.some((line) => line.includes(needle))) {
    if (Date.now() - start > 2000) {
      throw new Error(`access log missing ${needle}: ${lines.join(" | ")}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

test("免令牌白名单仅 GET /api/media-ticket/:id；访问日志路径丢掉 ticketId", () => {
  assert.equal(isTokenExemptPath("GET", "/api/media-ticket/abc123", false), true);
  assert.equal(isTokenExemptPath("POST", "/api/projects/current/media-tickets", false), false);
  assert.equal(isTokenExemptPath("GET", "/api/projects/current/media-tickets", false), false);
  assert.equal(isTokenExemptPath("GET", "/api/projects/current", false), false);
  assert.equal(redactMediaTicketPath("/api/media-ticket/abc123"), "/api/media-ticket/:ticketId");
  assert.equal(redactMediaTicketPath("/api/projects/current"), "/api/projects/current");
});

test("合法 derived 签发；GET 免 Bearer 返回字节；Range；访问日志丢掉 ticketId 与 Authorization", async () => {
  const accessLog: string[] = [];
  const app = await startTestApp({ accessLog: (line) => accessLog.push(line) });
  try {
    await openProjectWithThumb(app);
    const issued = await issueThumbTicket(app);
    const ttl = Date.parse(issued.expiresAt) - Date.now();
    assert.ok(ttl > 9 * 60 * 1000);
    assert.ok(ttl <= 10 * 60 * 1000 + 2000);

    const getRes = await fetch(`${app.baseUrl}/api/media-ticket/${issued.ticketId}`);
    assert.equal(getRes.status, 200);
    assert.match(getRes.headers.get("content-type") ?? "", /image\/webp/);
    assert.equal(getRes.headers.get("accept-ranges"), "bytes");
    const bytes = Buffer.from(await getRes.arrayBuffer());
    assert.deepEqual(bytes, THUMB_BYTES);

    const rangeRes = await fetch(`${app.baseUrl}/api/media-ticket/${issued.ticketId}`, {
      headers: { Range: "bytes=0-4" },
    });
    assert.equal(rangeRes.status, 206);
    assert.equal(rangeRes.headers.get("content-range"), `bytes 0-4/${THUMB_BYTES.length}`);
    const ranged = Buffer.from(await rangeRes.arrayBuffer());
    assert.deepEqual(ranged, THUMB_BYTES.subarray(0, 5));

    await waitForLog(accessLog, "GET /api/media-ticket/:ticketId 200");
    const joined = accessLog.join("\n");
    assert.equal(joined.includes(issued.ticketId), false);
    assert.equal(joined.toLowerCase().includes("authorization"), false);
    assert.equal(joined.includes(app.token), false);

    const noTokPost = await fetch(`${app.baseUrl}/api/projects/current/media-tickets`, {
      method: "POST",
      headers: {
        Origin: app.origin,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ relativePath: THUMB_REL, purpose: "thumb" }),
    });
    assert.equal(noTokPost.status, 401);
  } finally {
    await stopTestApp(app);
  }
});

test("路径未被当前文档引用则 403", async () => {
  const app = await startTestApp();
  try {
    await openProjectWithThumb(app);
    const res = await fetch(`${app.baseUrl}/api/projects/current/media-tickets`, {
      method: "POST",
      headers: headers(app.origin),
      body: JSON.stringify({ relativePath: OTHER_THUMB_REL, purpose: "thumb" }),
    });
    assert.equal(res.status, 403);
    const body = (await res.json()) as { message: string };
    assert.equal(body.message, BACKEND_MESSAGES.forbiddenRequest);
  } finally {
    await stopTestApp(app);
  }
});

test("purpose=original 被画布当节点 img 则 403", async () => {
  const app = await startTestApp();
  try {
    await openProjectWithThumb(app);
    const res = await fetch(`${app.baseUrl}/api/projects/current/media-tickets`, {
      method: "POST",
      headers: headers(app.origin),
      body: JSON.stringify({ relativePath: THUMB_REL, purpose: "original" }),
    });
    assert.equal(res.status, 403);
    const body = (await res.json()) as { message: string };
    assert.equal(body.message, BACKEND_MESSAGES.forbiddenRequest);
  } finally {
    await stopTestApp(app);
  }
});

test("过期票据 GET 403 正文是预览地址已过期。", async () => {
  let nowMs = Date.parse("2026-09-24T12:00:00.000Z");
  const app = await startTestApp({ now: () => new Date(nowMs) });
  try {
    await openProjectWithThumb(app);
    const issued = await issueThumbTicket(app);
    assert.equal(issued.expiresAt, "2026-09-24T12:10:00.000Z");

    const fresh = await fetch(`${app.baseUrl}/api/media-ticket/${issued.ticketId}`);
    assert.equal(fresh.status, 200);
    await fresh.arrayBuffer();

    nowMs = Date.parse("2026-09-24T12:10:00.000Z");
    const expired = await fetch(`${app.baseUrl}/api/media-ticket/${issued.ticketId}`);
    assert.equal(expired.status, 403);
    const body = (await expired.json()) as { message: string };
    assert.equal(body.message, USER_FACING.ticketExpired);
    assert.equal(body.message, "预览地址已过期。");

    const unknown = await fetch(`${app.baseUrl}/api/media-ticket/not-issued`);
    assert.equal(unknown.status, 403);
    const unknownBody = (await unknown.json()) as { message: string };
    assert.equal(unknownBody.message, USER_FACING.ticketExpired);
  } finally {
    await stopTestApp(app);
  }
});

test("错误 Origin 仍拒绝 POST media-tickets", async () => {
  const app = await startTestApp();
  try {
    await openProjectWithThumb(app);
    const res = await fetch(`${app.baseUrl}/api/projects/current/media-tickets`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${app.token}`,
        Origin: "http://example.com",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ relativePath: THUMB_REL, purpose: "thumb" }),
    });
    assert.equal(res.status, 403);
    assert.equal(res.headers.get("access-control-allow-origin"), null);
  } finally {
    await stopTestApp(app);
  }
});

test("工程 JSON、回收站、非法相对路径 400，不签发", async () => {
  const app = await startTestApp();
  try {
    await openProjectWithThumb(app);
    const cases = [
      "canvas.project.json",
      "media/trash/batch/x.blob",
      "tasks/journal.jsonl",
      "../media/derived/aa/x.webp",
      "C:/media/derived/aa/x.webp",
    ];
    for (const relativePath of cases) {
      const res = await fetch(`${app.baseUrl}/api/projects/current/media-tickets`, {
        method: "POST",
        headers: headers(app.origin),
        body: JSON.stringify({ relativePath, purpose: "thumb" }),
      });
      assert.equal(res.status, 400, relativePath);
      const body = (await res.json()) as { message: string };
      assert.equal(body.message, BACKEND_MESSAGES.invalidMediaPath);
    }
  } finally {
    await stopTestApp(app);
  }
});

test("plant 落盘 → PUT 204 → 客户端 ack 等价 → POST tickets 201 → GET 无 Bearer 200", async () => {
  const app = await startTestApp();
  try {
    const created = await createProject(app, "plant-demo");
    assert.equal(created.status, 201);
    const blobRel = `media/blobs/${FIXTURE_THUMB_SHA256.slice(0, 2)}/${FIXTURE_THUMB_SHA256}.blob`;
    const put = await fetch(`${app.baseUrl}/api/projects/current/working-copy`, {
      method: "PUT",
      headers: headers(app.origin),
      body: JSON.stringify({
        contentRevision: 0,
        nodes: {
          img1: imageNode(
            "img1",
            imageOutput({
              relativePath: blobRel,
              contentHash: FIXTURE_THUMB_SHA256,
              thumbRelativePath: FIXTURE_THUMB_REL_PATH,
            }),
          ),
        },
        edges: {},
        groups: {},
      }),
    });
    assert.equal(put.status, 204);
    assert.equal(put.headers.get("X-Content-Revision"), "1");
    const issued = await fetch(`${app.baseUrl}/api/projects/current/media-tickets`, {
      method: "POST",
      headers: headers(app.origin),
      body: JSON.stringify({ relativePath: FIXTURE_THUMB_REL_PATH, purpose: "thumb" }),
    });
    assert.equal(issued.status, 201);
    const body = (await issued.json()) as { ticketId: string };
    const getRes = await fetch(`${app.baseUrl}/api/media-ticket/${body.ticketId}`);
    assert.equal(getRes.status, 200);
    const bytes = Buffer.from(await getRes.arrayBuffer());
    assert.deepEqual(bytes, Buffer.from(FIXTURE_THUMB_BYTES));
  } finally {
    await stopTestApp(app);
  }
});
