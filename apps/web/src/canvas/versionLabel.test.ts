import assert from "node:assert/strict";
import { test } from "node:test";
import type { ProjectNode } from "@canvas/schema";
import { versionLabel } from "./versionLabel.ts";

test("版本标签是「版本 2 / 共 N」", () => {
  const versions = [
    { id: "a" },
    { id: "b" },
    { id: "c" },
  ] as NonNullable<ProjectNode["versions"]>;
  assert.equal(versionLabel({ currentVersionId: "b", versions }), "版本 2 / 共 3");
  assert.equal(versionLabel({ currentVersionId: null, versions: [] }), null);
});
