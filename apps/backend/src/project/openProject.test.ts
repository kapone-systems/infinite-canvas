import assert from "node:assert/strict";
import { cp, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { USER_FACING } from "@canvas/schema";
import { headers, startTestApp, stopTestApp, textNode, createProject } from "../http/testApp.ts";
import { projectBakPath, projectFilePath } from "./atomicWrite.ts";

test("工程文件夹拷到另一路径仍能打开，JSON 无盘符/绝对路径", async () => {
  const app = await startTestApp();
  try {
    const created = await createProject(app, "portable");
    const dir = created.body.absolutePath as string;
    await fetch(`${app.baseUrl}/api/projects/current/working-copy`, {
      method: "PUT",
      headers: headers(app.origin),
      body: JSON.stringify({
        contentRevision: 0,
        nodes: { n1: textNode("n1", "可拷走") },
        edges: {},
        groups: {},
      }),
    });
    const saved = await fetch(`${app.baseUrl}/api/projects/current`, {
      method: "PUT",
      headers: headers(app.origin),
      body: "{}",
    });
    assert.equal(saved.status, 200);

    const copyDir = join(app.projectsDir, "portable-copy");
    await cp(dir, copyDir, { recursive: true });
    const copiedJson = await readFile(projectFilePath(copyDir), "utf8");
    assert.equal(copiedJson.includes("absolutePath"), false);
    assert.doesNotMatch(copiedJson, /[A-Za-z]:[\\/]/);
    assert.doesNotMatch(copiedJson, /\\\\Users\\\\/);

    app.backend.session.clear();
    const opened = await fetch(`${app.baseUrl}/api/projects/open`, {
      method: "POST",
      headers: headers(app.origin),
      body: JSON.stringify({ absolutePath: copyDir }),
    });
    assert.equal(opened.status, 200);
    const body = (await opened.json()) as {
      dirty: boolean;
      absolutePath: string;
      project: { nodes: { n1?: { text?: string } }; projectId: string };
    };
    assert.equal(body.dirty, false);
    assert.equal(body.absolutePath, copyDir);
    assert.equal(body.project.nodes.n1?.text, "可拷走");
    assert.equal("absolutePath" in body.project, false);
  } finally {
    await stopTestApp(app);
  }
});

const HASH = "ab".repeat(32);
const BLOB = `media/blobs/ab/${HASH}.blob`;

function imageNode(id: string): Record<string, unknown> {
  return {
    id,
    kind: "image",
    title: "可拷走的图",
    x: 12,
    y: 24,
    width: 280,
    height: 80,
    z: 1,
    groupId: null,
    origin: "imported",
    createdAt: "2026-09-24T00:00:00.000Z",
    updatedAt: "2026-09-24T00:00:00.000Z",
    outputRevision: 1,
    output: {
      kind: "image",
      relativePath: BLOB,
      contentHash: HASH,
      byteSize: 8,
      mimeDetected: "image/png",
      width: 1,
      height: 1,
      durationMs: null,
      firstFrameRelativePath: null,
      lastFrameRelativePath: null,
      coverRelativePath: null,
      proxyRelativePath: null,
      thumbRelativePath: `media/derived/ab/${HASH}/thumb-webp-longedge-512-v1/${HASH}.webp`,
    },
  };
}

async function revisionOf(app: Awaited<ReturnType<typeof startTestApp>>): Promise<number> {
  const current = await fetch(`${app.baseUrl}/api/projects/current`, {
    headers: { Authorization: `Bearer ${app.token}` },
  });
  const body = (await current.json()) as { project: { contentRevision: number } };
  return body.project.contentRevision;
}

async function putNodes(
  app: Awaited<ReturnType<typeof startTestApp>>,
  nodes: Record<string, unknown>,
): Promise<void> {
  const contentRevision = await revisionOf(app);
  const put = await fetch(`${app.baseUrl}/api/projects/current/working-copy`, {
    method: "PUT",
    headers: headers(app.origin),
    body: JSON.stringify({ contentRevision, nodes, edges: {}, groups: {} }),
  });
  assert.equal(put.status, 204);
}

async function save(app: Awaited<ReturnType<typeof startTestApp>>): Promise<void> {
  const saved = await fetch(`${app.baseUrl}/api/projects/current`, {
    method: "PUT",
    headers: headers(app.origin),
    body: "{}",
  });
  assert.equal(saved.status, 200);
}

function blobAbs(dir: string): string {
  return join(dir, "media", "blobs", "ab", `${HASH}.blob`);
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

test("整夹拷走再打开，图还在；JSON 无二进制、无 test-key-not-real、无 apiKey", async () => {
  const app = await startTestApp();
  try {
    const created = await createProject(app, "with-image");
    const dir = created.body.absolutePath as string;
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    await mkdir(join(dir, "media", "blobs", "ab"), { recursive: true });
    await writeFile(blobAbs(dir), bytes);
    await putNodes(app, { img: imageNode("img") });
    await save(app);
    const copyDir = join(app.projectsDir, "with-image-copy");
    await cp(dir, copyDir, { recursive: true });
    const copied = await readFile(projectFilePath(copyDir));
    const text = copied.toString("utf8");
    assert.equal(text.includes("test-key-not-real"), false);
    assert.equal(text.includes("apiKey"), false);
    assert.equal(copied.includes(bytes), false);
    assert.equal(text.includes("\u0000"), false);
    JSON.parse(text);
    app.backend.session.clear();
    const opened = await fetch(`${app.baseUrl}/api/projects/open`, {
      method: "POST",
      headers: headers(app.origin),
      body: JSON.stringify({ absolutePath: copyDir }),
    });
    assert.equal(opened.status, 200);
    const body = (await opened.json()) as {
      project: { nodes: { img?: { output?: { relativePath?: string } } } };
    };
    assert.equal(body.project.nodes.img?.output?.relativePath, BLOB);
    assert.equal(await fileExists(blobAbs(copyDir)), true);
  } finally {
    await stopTestApp(app);
  }
});

test("删除节点、保存、关掉再打开：文件在 media/trash，不是当场没了", async () => {
  const app = await startTestApp();
  try {
    const created = await createProject(app, "recycle-demo");
    const dir = created.body.absolutePath as string;
    await mkdir(join(dir, "media", "blobs", "ab"), { recursive: true });
    await writeFile(blobAbs(dir), "png");
    await putNodes(app, { img: imageNode("img") });
    await save(app);
    await putNodes(app, {});
    const trash = join(dir, "media", "trash", "blobs", "ab", `${HASH}.blob`);
    assert.equal(await fileExists(blobAbs(dir)), true);
    assert.equal(await fileExists(trash), false);
    await save(app);
    assert.equal(await fileExists(blobAbs(dir)), true);
    assert.equal(await fileExists(trash), false);
    app.backend.session.clear();
    const stillHeld = await fetch(`${app.baseUrl}/api/projects/open`, {
      method: "POST",
      headers: headers(app.origin),
      body: JSON.stringify({ absolutePath: dir }),
    });
    assert.equal(stillHeld.status, 200);
    assert.equal(await fileExists(blobAbs(dir)), true);
    assert.equal(await fileExists(trash), false);
    await save(app);
    app.backend.session.clear();
    const opened = await fetch(`${app.baseUrl}/api/projects/open`, {
      method: "POST",
      headers: headers(app.origin),
      body: JSON.stringify({ absolutePath: dir }),
    });
    assert.equal(opened.status, 200);
    assert.equal(await fileExists(blobAbs(dir)), false);
    assert.equal(await fileExists(trash), true);
    const disk = await readFile(projectFilePath(dir), "utf8");
    assert.equal(disk.includes("找不到原来的媒体文件"), false);
  } finally {
    await stopTestApp(app);
  }
});

test("移走被引用的 blob 再打开：missingMedia 是正斜杠相对路径，不写进工程", async () => {
  const app = await startTestApp();
  try {
    const created = await createProject(app, "missing-blob");
    const dir = created.body.absolutePath as string;
    await putNodes(app, { img: imageNode("img") });
    await save(app);
    app.backend.session.clear();
    const opened = await fetch(`${app.baseUrl}/api/projects/open`, {
      method: "POST",
      headers: headers(app.origin),
      body: JSON.stringify({ absolutePath: dir }),
    });
    assert.equal(opened.status, 200);
    const body = (await opened.json()) as { missingMedia?: string[] };
    assert.deepEqual(body.missingMedia, [BLOB]);
    const disk = await readFile(projectFilePath(dir), "utf8");
    assert.equal(disk.includes("找不到原来的媒体文件"), false);
    assert.equal(BLOB.includes("\\"), false);
  } finally {
    await stopTestApp(app);
  }
});

test("正式文件解析失败且 bak 完整则打开备份句；两份都坏不建空工程", async () => {
  const app = await startTestApp();
  try {
    const created = await createProject(app, "bak-open");
    const dir = created.body.absolutePath as string;
    const good = await readFile(projectFilePath(dir), "utf8");
    app.backend.session.clear();
    await writeFile(projectFilePath(dir), "{", "utf8");
    await writeFile(projectBakPath(dir), good, "utf8");
    const opened = await fetch(`${app.baseUrl}/api/projects/open`, {
      method: "POST",
      headers: headers(app.origin),
      body: JSON.stringify({ absolutePath: dir }),
    });
    assert.equal(opened.status, 200);
    const body = (await opened.json()) as { message?: string; project: { name: string } };
    assert.equal(body.message, USER_FACING.openedFromBackup);
    assert.equal(body.message, "工程文件损坏，已打开上一份备份。");
    assert.notEqual(body.message, USER_FACING.restoredFromAutosave);
    assert.equal(body.project.name, "bak-open");

    app.backend.session.clear();
    await writeFile(projectBakPath(dir), "{", "utf8");
    const both = await fetch(`${app.baseUrl}/api/projects/open`, {
      method: "POST",
      headers: headers(app.origin),
      body: JSON.stringify({ absolutePath: dir }),
    });
    assert.equal(both.status, 422);
    const bothBody = (await both.json()) as { message: string };
    assert.equal(bothBody.message, "工程文件损坏，而且没有可用的备份。文件还留在原地。");
    const current = await fetch(`${app.baseUrl}/api/projects/current`, {
      headers: { Authorization: `Bearer ${app.token}` },
    });
    assert.equal(current.status, 404);
    assert.equal(await fileExists(projectFilePath(dir)), true);
  } finally {
    await stopTestApp(app);
  }
});

test("正式文件解析失败且 bak 太新仍是 422，不打开", async () => {
  const app = await startTestApp();
  try {
    const dir = join(app.projectsDir, "bak-newer");
    await mkdir(dir);
    await writeFile(projectFilePath(dir), "{", "utf8");
    await writeFile(projectBakPath(dir), JSON.stringify({ schemaVersion: 2 }), "utf8");
    const opened = await fetch(`${app.baseUrl}/api/projects/open`, {
      method: "POST",
      headers: headers(app.origin),
      body: JSON.stringify({ absolutePath: dir }),
    });
    assert.equal(opened.status, 422);
    const body = (await opened.json()) as { message: string };
    assert.equal(body.message, USER_FACING.schemaVersionNewer);
    const current = await fetch(`${app.baseUrl}/api/projects/current`, {
      headers: { Authorization: `Bearer ${app.token}` },
    });
    assert.equal(current.status, 404);
  } finally {
    await stopTestApp(app);
  }
});
