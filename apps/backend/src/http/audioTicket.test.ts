import assert from "node:assert/strict";
import { test } from "node:test";
import type { MediaRef, ProjectNode } from "@canvas/schema";
import { ingestBytes } from "../media/ingest.ts";
import { createProject, headers, startTestApp, stopTestApp, type TestApp } from "./testApp.ts";

function pcmWav(samples: number, sampleRate = 8000): Buffer {
  const dataBytes = samples * 2;
  const buf = Buffer.alloc(44 + dataBytes);
  buf.write("RIFF", 0, "ascii");
  buf.writeUInt32LE(36 + dataBytes, 4);
  buf.write("WAVE", 8, "ascii");
  buf.write("fmt ", 12, "ascii");
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36, "ascii");
  buf.writeUInt32LE(dataBytes, 40);
  return buf;
}

function audioNode(media: MediaRef): ProjectNode {
  return {
    id: "aud1",
    kind: "audio",
    title: "音频 1",
    x: 0,
    y: 0,
    width: 280,
    height: 96,
    z: 0,
    groupId: null,
    origin: "imported",
    createdAt: "2026-09-26T00:00:00.000Z",
    updatedAt: "2026-09-26T00:00:00.000Z",
    outputRevision: 1,
    output: media,
  };
}

async function issue(
  app: TestApp,
  relativePath: string,
  purpose: string,
): Promise<{ status: number; ticketId?: string }> {
  const res = await fetch(`${app.baseUrl}/api/projects/current/media-tickets`, {
    method: "POST",
    headers: headers(app.origin),
    body: JSON.stringify({ relativePath, purpose }),
  });
  if (res.status !== 201) {
    return { status: res.status };
  }
  const body = (await res.json()) as { ticketId: string };
  return { status: res.status, ticketId: body.ticketId };
}

test("purpose=audio 按魔数回 audio/wav；original 仍是 octet-stream；thumb 不签", async () => {
  const app = await startTestApp();
  try {
    const created = await createProject(app, "audio-ticket");
    assert.equal(created.status, 201);
    const projectDir = created.body.absolutePath as string;
    const ingested = await ingestBytes({
      projectRoot: projectDir,
      bytes: pcmWav(64),
      originalFileName: "clip.wav",
      ffprobePath: "canvas-ffprobe-missing",
      makeThumb: true,
    });
    assert.equal(ingested.ok, true);
    if (!ingested.ok) {
      return;
    }
    assert.equal(ingested.media.kind, "audio");
    const put = await fetch(`${app.baseUrl}/api/projects/current/working-copy`, {
      method: "PUT",
      headers: headers(app.origin),
      body: JSON.stringify({
        contentRevision: 0,
        nodes: { aud1: audioNode(ingested.media) },
        edges: {},
        groups: {},
      }),
    });
    assert.equal(put.status, 204);

    const audio = await issue(app, ingested.media.relativePath, "audio");
    assert.equal(audio.status, 201);
    assert.equal(typeof audio.ticketId, "string");
    const audioGet = await fetch(`${app.baseUrl}/api/media-ticket/${audio.ticketId}`);
    assert.equal(audioGet.status, 200);
    assert.match(audioGet.headers.get("content-type") ?? "", /^audio\/wav/);
    assert.equal(audioGet.headers.get("x-content-type-options"), "nosniff");
    const bytes = Buffer.from(await audioGet.arrayBuffer());
    assert.equal(bytes.subarray(0, 4).toString("ascii"), "RIFF");

    const original = await issue(app, ingested.media.relativePath, "original");
    assert.equal(original.status, 201);
    const originalGet = await fetch(`${app.baseUrl}/api/media-ticket/${original.ticketId}`);
    assert.equal(originalGet.status, 200);
    assert.match(originalGet.headers.get("content-type") ?? "", /^application\/octet-stream/);
    await originalGet.arrayBuffer();

    assert.equal((await issue(app, ingested.media.relativePath, "thumb")).status, 403);
    assert.equal((await issue(app, ingested.media.relativePath, "proxy")).status, 403);
    assert.equal((await issue(app, ingested.media.relativePath, "cover")).status, 403);
  } finally {
    await stopTestApp(app);
  }
});
