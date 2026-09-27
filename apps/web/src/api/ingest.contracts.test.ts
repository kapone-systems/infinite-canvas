/// <reference types="node" />
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

test("ingest 字段名为 file；禁止 createObjectURL", () => {
  const api = readFileSync(join(here, "client.ts"), "utf8");
  assert.equal(api.includes('body.append("file"'), true);
  assert.equal(api.includes("/api/projects/current/media/ingest"), true);
  assert.equal(api.includes("createObjectURL"), false);
});
