import assert from "node:assert/strict";
import { mkdir, readFile, stat, utimes, writeFile } from "node:fs/promises";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createEmptyProject, type CanvasProjectFile } from "@canvas/schema";
import { atomicWriteJson, projectAutosavePath, projectBakPath, projectFilePath } from "../project/atomicWrite.ts";
import { absFromRel } from "./layout.ts";
import { emptyTrash, recycleUnreferencedMedia } from "./recycle.ts";

const HASH_A = "ab".repeat(32);
const HASH_B = "cd".repeat(32);
const HASH_C = "ef".repeat(32);

function blob(hash: string): string {
  return `media/blobs/${hash.slice(0, 2)}/${hash}.blob`;
}

function sidecar(hash: string): string {
  return `media/sidecars/${hash.slice(0, 2)}/${hash}.json`;
}

function derived(hash: string): string {
  return `media/derived/${hash.slice(0, 2)}/${hash}/thumb-webp-longedge-512-v1/${hash}.webp`;
}

function projectWith(paths: string[]): CanvasProjectFile {
  const project = createEmptyProject({ projectId: "p", name: "p", now: new Date("2026-09-24T00:00:00.000Z") });
  project.nodes.img = {
    id: "img",
    kind: "image",
    title: "图",
    x: 0,
    y: 0,
    width: 280,
    height: 80,
    z: 1,
    groupId: null,
    origin: "imported",
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    outputRevision: 1,
    output: {
      kind: "image",
      relativePath: paths[0] ?? blob(HASH_A),
      contentHash: HASH_A,
      byteSize: 4,
      mimeDetected: "image/png",
      width: 1,
      height: 1,
      durationMs: null,
      firstFrameRelativePath: null,
      lastFrameRelativePath: null,
      coverRelativePath: null,
      proxyRelativePath: null,
      thumbRelativePath: derived(HASH_A),
    },
  };
  return project;
}

async function putFile(root: string, rel: string, body = "x"): Promise<void> {
  const abs = absFromRel(root, rel);
  await mkdir(join(abs, ".."), { recursive: true });
  await writeFile(abs, body);
}

async function exists(root: string, rel: string): Promise<boolean> {
  try {
    await stat(absFromRel(root, rel));
    return true;
  } catch {
    return false;
  }
}

test("无人引用进 trash；同哈希 sidecar 和 derived 留下；incoming 不动；失败则取消", async () => {
  const root = await mkdtemp(join(tmpdir(), "canvas-recycle-"));
  try {
    const keep = blob(HASH_A);
    const drop = blob(HASH_B);
    const textPath = blob(HASH_C);
    await putFile(root, keep);
    await putFile(root, sidecar(HASH_A), "{}");
    await putFile(root, derived(HASH_A), "thumb");
    await putFile(root, drop);
    await putFile(root, sidecar(HASH_B), "{}");
    await putFile(root, derived(HASH_B), "old");
    await putFile(root, "media/incoming/task.part", "part");
    const project = projectWith([keep]);
    const img = project.nodes.img;
    if (img === undefined) {
      throw new Error("img");
    }
    img.outputText = textPath;
    await putFile(root, textPath, "text-blob");
    await atomicWriteJson(projectFilePath(root), project, { backup: false });
    const moved = await recycleUnreferencedMedia(root);
    assert.equal(moved.ok, true);
    if (moved.ok) {
      assert.equal(moved.moved.includes(drop), true);
    }
    assert.equal(await exists(root, keep), true);
    assert.equal(await exists(root, sidecar(HASH_A)), true);
    assert.equal(await exists(root, derived(HASH_A)), true);
    assert.equal(await exists(root, textPath), true);
    assert.equal(await exists(root, drop), false);
    assert.equal(await exists(root, `media/trash/blobs/${HASH_B.slice(0, 2)}/${HASH_B}.blob`), true);
    assert.equal(await exists(root, sidecar(HASH_B)), false);
    assert.equal(await exists(root, "media/incoming/task.part"), true);

    const freshTrash = `media/trash/blobs/${HASH_B.slice(0, 2)}/${HASH_B}.blob`;
    assert.equal(await exists(root, freshTrash), true);

    const oldTrash = "media/trash/blobs/old.bin";
    const youngTrash = "media/trash/blobs/young.bin";
    await putFile(root, oldTrash, "old");
    await putFile(root, youngTrash, "young");
    const oldAbs = absFromRel(root, oldTrash);
    const youngAbs = absFromRel(root, youngTrash);
    const past = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
    const recent = new Date(Date.now() - 6 * 24 * 60 * 60 * 1000);
    await utimes(oldAbs, past, past);
    await utimes(youngAbs, recent, recent);
    const again = await recycleUnreferencedMedia(root);
    assert.equal(again.ok, true);
    assert.equal(await exists(root, oldTrash), false);
    assert.equal(await exists(root, youngTrash), true);
    assert.equal(await exists(root, freshTrash), true);

    const held = "media/trash/blobs/held.bin";
    await putFile(root, held, "held");
    await utimes(absFromRel(root, held), past, past);
    await writeFile(projectBakPath(root), "{", "utf8");
    await putFile(root, blob("11".repeat(32)), "orphan");
    const cancelled = await recycleUnreferencedMedia(root);
    assert.deepEqual(cancelled, { ok: false, reason: "cancelled" });
    assert.equal(await exists(root, blob("11".repeat(32))), true);
    assert.equal(await exists(root, held), true);

    await emptyTrash(root);
    assert.equal(await exists(root, youngTrash), false);
    assert.equal(await exists(root, held), false);
    assert.equal(await exists(root, keep), true);
    assert.equal(await exists(root, "media/incoming/task.part"), true);
    const official = await readFile(projectFilePath(root), "utf8");
    assert.equal(official.includes("apiKey"), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("autosave 仍引用时不进 trash；autosave 解析失败则取消", async () => {
  const root = await mkdtemp(join(tmpdir(), "canvas-recycle-auto-"));
  try {
    const keep = blob(HASH_A);
    await putFile(root, keep);
    const official = createEmptyProject({ projectId: "p", name: "p", now: new Date("2026-09-24T00:00:00.000Z") });
    const autosave = projectWith([keep]);
    autosave.contentRevision = 1;
    await atomicWriteJson(projectFilePath(root), official, { backup: false });
    await atomicWriteJson(projectAutosavePath(root), autosave, { backup: false });
    const kept = await recycleUnreferencedMedia(root);
    assert.equal(kept.ok, true);
    assert.equal(await exists(root, keep), true);

    await writeFile(projectAutosavePath(root), "not-json", "utf8");
    await putFile(root, blob(HASH_B));
    const cancelled = await recycleUnreferencedMedia(root);
    assert.deepEqual(cancelled, { ok: false, reason: "cancelled" });
    assert.equal(await exists(root, blob(HASH_B)), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("只被 bak 引用的文件留在 blobs；bak 不再引用后再打开才进 trash", async () => {
  const root = await mkdtemp(join(tmpdir(), "canvas-recycle-bak-"));
  try {
    const onlyBak = blob(HASH_A);
    await putFile(root, onlyBak, "bak-only");
    const official = createEmptyProject({ projectId: "p", name: "p", now: new Date("2026-09-24T00:00:00.000Z") });
    const bakProject = projectWith([onlyBak]);
    await atomicWriteJson(projectFilePath(root), official, { backup: false });
    await atomicWriteJson(projectBakPath(root), bakProject, { backup: false });
    const kept = await recycleUnreferencedMedia(root);
    assert.equal(kept.ok, true);
    assert.equal(await exists(root, onlyBak), true);
    assert.equal(await exists(root, `media/trash/blobs/${HASH_A.slice(0, 2)}/${HASH_A}.blob`), false);

    await atomicWriteJson(projectBakPath(root), official, { backup: false });
    const moved = await recycleUnreferencedMedia(root);
    assert.equal(moved.ok, true);
    assert.equal(await exists(root, onlyBak), false);
    assert.equal(await exists(root, `media/trash/blobs/${HASH_A.slice(0, 2)}/${HASH_A}.blob`), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
