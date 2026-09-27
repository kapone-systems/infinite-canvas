import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import type { ProjectEdge, ProjectNode, Slot } from "@canvas/schema";
import { provenanceSourceLine, slotSourceLine } from "./sourceLine.ts";

const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "sourceLine.ts"), "utf8");

test("来源用槽显示名和上游标题，拖出素材用来源节点标题，不出现 Comfy 类名", () => {
  assert.equal(src.includes("KSampler"), false);
  assert.equal(src.includes("VAE"), false);
  assert.equal(src.includes("Checkpoint"), false);
  assert.equal(src.includes("CLIP"), false);
  const upstream: ProjectNode = {
    id: "up",
    kind: "image",
    title: "海边的房子",
    x: 0,
    y: 0,
    width: 280,
    height: 80,
    z: 1,
    groupId: null,
    origin: "imported",
    createdAt: "2026-09-24T00:00:00.000Z",
    updatedAt: "2026-09-24T00:00:00.000Z",
    outputRevision: 1,
  };
  const slot: Slot = { id: "s", role: "source_image", order: 1, edgeId: "e" };
  const slots: Slot[] = [
    { id: "p", role: "prompt", order: 0, edgeId: null },
    slot,
  ];
  const edges: Record<string, ProjectEdge> = {
    e: {
      id: "e",
      sourceNodeId: "up",
      targetNodeId: "g",
      targetSlotId: "s",
      role: "source_image",
    },
  };
  const line = slotSourceLine(slot, slots, { up: upstream }, edges);
  assert.equal(line, "原图 · 海边的房子");
  const detached: ProjectNode = {
    ...upstream,
    id: "det",
    origin: "detached",
    provenance: { sourceNodeId: "up", versionId: "v", variantId: "var" },
  };
  assert.equal(provenanceSourceLine(detached, { up: upstream, det: detached }), "海边的房子");
});
