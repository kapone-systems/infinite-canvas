import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { atomicWriteFile, projectBakPath, projectFilePath } from "./atomicWrite.ts";

test("原子写保留 .bak 为上一份内容", async () => {
  const dir = await mkdtemp(join(tmpdir(), "canvas-atomic-"));
  const target = projectFilePath(dir);
  await atomicWriteFile(target, "first\n", { backup: true });
  assert.equal(await readFile(target, "utf8"), "first\n");
  await atomicWriteFile(target, "second\n", { backup: true });
  assert.equal(await readFile(target, "utf8"), "second\n");
  assert.equal(await readFile(projectBakPath(dir), "utf8"), "first\n");
  await atomicWriteFile(target, "third\n", { backup: true });
  assert.equal(await readFile(target, "utf8"), "third\n");
  assert.equal(await readFile(`${target}.bak`, "utf8"), "second\n");
});
