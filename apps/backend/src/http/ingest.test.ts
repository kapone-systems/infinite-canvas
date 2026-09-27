import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { blobRelPath, USER_FACING } from "@canvas/schema";
import { encodePngRgba } from "../media/png.ts";
import { sniffMagic } from "../media/magic.ts";
import { MEDIA_INGEST_FIELD, MEDIA_INGEST_PATH } from "./ingest.ts";
import { createProject, headers, startTestApp, stopTestApp, type TestApp } from "./testApp.ts";

function redPng(): Uint8Array {
  const encoded = encodePngRgba(1, 1, new Uint8Array([12, 34, 56, 255]));
  const copy = new Uint8Array(encoded.byteLength);
  copy.set(encoded);
  return copy;
}

function pngFile(name: string, bytes: Uint8Array = redPng()): File {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return new File([copy], name, { type: "image/png" });
}

function ingestHeaders(app: TestApp): Record<string, string> {
  return {
    Authorization: `Bearer ${app.token}`,
    Origin: app.origin,
  };
}

async function postIngest(app: TestApp, form: FormData): Promise<Response> {
  return fetch(`${app.baseUrl}${MEDIA_INGEST_PATH}`, {
    method: "POST",
    headers: ingestHeaders(app),
    body: form,
  });
}

test("createServer 在 JSON 读体之前分流 ingest，且不退回 handleProjects", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const src = readFileSync(join(here, "createServer.ts"), "utf8");
  const ingestIdx = src.indexOf("handleMediaIngest");
  const jsonIdx = src.indexOf("readRequestBody(req)");
  assert.equal(ingestIdx >= 0, true);
  assert.equal(jsonIdx >= 0, true);
  assert.equal(ingestIdx < jsonIdx, true);
  const projects = readFileSync(join(here, "projects.ts"), "utf8");
  assert.equal(projects.includes("media/ingest"), false);
});

test("POST ingest 字段 file：入库、复用、拒 SVG/错字段；先入库不建节点", async () => {
  const app = await startTestApp();
  try {
    const missing = new FormData();
    missing.append(MEDIA_INGEST_FIELD, pngFile("a.png"));
    const noProject = await postIngest(app, missing);
    assert.equal(noProject.status, 404);
    assert.equal(((await noProject.json()) as { message: string }).message, USER_FACING.noProject);

    const created = await createProject(app, "ingest-http");
    assert.equal(created.status, 201);
    const projectDir = created.body.absolutePath as string;

    const wrongField = new FormData();
    wrongField.append("image", pngFile("boat.png"));
    const wrong = await postIngest(app, wrongField);
    assert.equal(wrong.status, 400);
    assert.equal(((await wrong.json()) as { message: string }).message, USER_FACING.ingestFailed);

    const svgForm = new FormData();
    const svgBytes = new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'></svg>");
    svgForm.append(MEDIA_INGEST_FIELD, new File([svgBytes], "x.svg", { type: "image/svg+xml" }));
    const svgRes = await postIngest(app, svgForm);
    assert.equal(svgRes.status, 400);
    assert.equal(((await svgRes.json()) as { message: string }).message, USER_FACING.ingestSvg);
    await assert.rejects(stat(join(projectDir, "media", "blobs")));

    const png = redPng();
    const expected = createHash("sha256").update(png).digest("hex");
    const form = new FormData();
    form.append(MEDIA_INGEST_FIELD, pngFile("boat.png", png));
    const res = await postIngest(app, form);
    assert.equal(res.status, 201);
    const body = (await res.json()) as {
      media: { contentHash: string; relativePath: string; thumbRelativePath: string | null };
    };
    assert.equal(body.media.contentHash, expected);
    assert.equal(body.media.relativePath, blobRelPath(expected));
    assert.equal(JSON.stringify(body).includes("blob:"), false);
    const blobAbs = join(projectDir, ...body.media.relativePath.split("/"));
    const onDisk = await readFile(blobAbs);
    assert.deepEqual(Uint8Array.from(onDisk), Uint8Array.from(png));
    if (body.media.thumbRelativePath !== null) {
      const thumbAbs = join(projectDir, ...body.media.thumbRelativePath.split("/"));
      const thumb = await readFile(thumbAbs);
      assert.equal(sniffMagic(thumb).magic, "webp");
    }

    const again = new FormData();
    again.append(MEDIA_INGEST_FIELD, pngFile("two.png", png));
    const res2 = await postIngest(app, again);
    assert.equal(res2.status, 201);
    const shard = await readdir(join(projectDir, "media", "blobs"));
    assert.equal(shard.length, 1);
    const files = await readdir(join(projectDir, "media", "blobs", shard[0] ?? ""));
    assert.equal(files.filter((name) => name.endsWith(".blob")).length, 1);

    const current = await fetch(`${app.baseUrl}/api/projects/current`, {
      headers: headers(app.origin),
    });
    const curBody = (await current.json()) as { project: { nodes: Record<string, unknown> } };
    assert.deepEqual(curBody.project.nodes, {});
  } finally {
    await stopTestApp(app);
  }
});
