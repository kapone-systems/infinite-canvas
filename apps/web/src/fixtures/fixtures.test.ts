/// <reference types="node" />
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { createEmptyProject, isValidProjectRelPath, validateProject } from "@canvas/schema";
import { EditorStore } from "../canvas/EditorStore.ts";
import { lodBand, planLod } from "../canvas/lod.ts";
import { LOD_FAR, LOD_NEAR } from "../canvas/metrics.ts";
import { copyFixtureMediaIntoProject } from "./copyMedia.ts";
import {
  DEFAULT_FIXTURE_SEED,
  FAR_ZOOM,
  LOAD_THOUSAND_LABEL,
  applyFixtureToStore,
  createCopyInternalEdgesFixture,
  createFixtureLoaders,
  createOverlapFixture,
  edgesWithBothEndsIn,
  farNodeId,
  generateHundredFixture,
  generateThousandFarFixture,
  generateTwentyFixture,
} from "./generate.ts";
import {
  FIXTURE_WEBP_BYTES,
  FIXTURE_WEBP_SHA256,
  THUMB_WEBP_LONGEDGE_512_V1,
  fixtureBlobRelPath,
  fixtureImageMediaRef,
  fixtureThumbRelPath,
} from "./media.ts";

const srcRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

test("相同种子得到相同坐标；二十 / 一百 / 一千同下标坐标一致", () => {
  const seed = DEFAULT_FIXTURE_SEED;
  const twentyA = generateTwentyFixture(seed);
  const twentyB = generateTwentyFixture(seed);
  const hundred = generateHundredFixture(seed);
  const thousand = generateThousandFarFixture(seed);
  assert.equal(Object.keys(twentyA.nodes).length, 20);
  assert.equal(Object.keys(hundred.nodes).length, 100);
  assert.equal(Object.keys(thousand.nodes).length, 1000);
  for (let i = 0; i < 20; i += 1) {
    const id = farNodeId(i);
    const a = twentyA.nodes[id];
    const b = twentyB.nodes[id];
    const c = hundred.nodes[id];
    const d = thousand.nodes[id];
    assert.ok(a && b && c && d);
    assert.equal(a.x, b.x);
    assert.equal(a.y, b.y);
    assert.equal(a.x, c.x);
    assert.equal(a.y, c.y);
    assert.equal(a.x, d.x);
    assert.equal(a.y, d.y);
  }
  const other = generateTwentyFixture(seed + 1);
  const origin = twentyA.nodes[farNodeId(0)];
  const shifted = other.nodes[farNodeId(0)];
  assert.ok(origin && shifted);
  assert.notDeepEqual({ x: origin.x, y: origin.y }, { x: shifted.x, y: shifted.y });
});

test("一百夹具默认近景，加载后 thumbIds 非空（P4 经票据）", () => {
  assert.equal(FAR_ZOOM[20], 1);
  assert.equal(FAR_ZOOM[100], LOD_NEAR);
  assert.equal(FAR_ZOOM[1000], 0.12);
  assert.ok(FAR_ZOOM[100] >= LOD_NEAR);
  assert.ok(FAR_ZOOM[1000] < LOD_FAR);

  const fixture = generateHundredFixture();
  assert.equal(fixture.viewport?.zoom, LOD_NEAR);
  assert.equal(lodBand(fixture.viewport?.zoom ?? 0), "near");
  const nodes = Object.values(fixture.nodes).map((node) => ({
    id: node.id,
    x: node.x,
    y: node.y,
    width: node.width,
    height: node.height,
    hasThumb: node.output?.thumbRelativePath != null,
  }));
  assert.ok(nodes.some((node) => node.hasThumb === true));
  const camera = fixture.viewport;
  assert.ok(camera);
  const plan = planLod({
    camera,
    viewport: { width: 1280, height: 720 },
    nodes,
  });
  assert.equal(plan.band, "near");
  assert.ok(plan.mountedIds.length > 0);
  assert.ok(plan.thumbIds.length > 0);

  const store = new EditorStore({
    idFactory: () => "unused",
    now: () => new Date("2026-09-24T00:00:00.000Z"),
  });
  store.loadProject(
    createEmptyProject({
      projectId: "open",
      name: "当前工程",
      now: new Date("2026-09-24T00:00:00.000Z"),
    }),
  );
  createFixtureLoaders(store).loadHundred();
  assert.equal(store.getSnapshot().camera.zoom, LOD_NEAR);
  assert.equal(lodBand(store.getSnapshot().camera.zoom), "near");
});

test("一千远夹具没有 video 字段、没有视频节点、不写 data URL", () => {
  const project = generateThousandFarFixture();
  const validated = validateProject(project);
  assert.equal(validated.ok, true);
  const json = JSON.stringify(project);
  assert.equal(json.includes("data:image/"), false);
  assert.equal(json.includes("data:video/"), false);
  assert.equal(json.includes("data:"), false);
  for (const node of Object.values(project.nodes)) {
    assert.notEqual(node.kind, "video");
    assert.equal(Object.hasOwn(node, "video"), false);
    if (node.output !== undefined && node.output !== null) {
      assert.notEqual(node.output.kind, "video");
      assert.equal(node.output.proxyRelativePath, null);
      assert.equal(node.output.durationMs, null);
    }
  }
  assert.equal(project.viewport?.zoom, 0.12);
});

test("复制内部边夹具可给 EditorStore 用，且只有两端都在选区的边算内部边", () => {
  const fixture = createCopyInternalEdgesFixture();
  const store = new EditorStore({
    idFactory: () => "unused",
    now: () => new Date("2026-09-24T00:00:00.000Z"),
  });
  store.loadProject(fixture.project);
  const snap = store.getSnapshot();
  assert.equal(snap.nodes.length, 3);
  const body = store.workingCopyBody();
  assert.ok(body);
  assert.ok(body.edges[fixture.internalEdgeId]);
  assert.ok(body.edges[fixture.externalEdgeId]);
  assert.equal(body.nodes[fixture.innerGenerationId]?.kind, "generation");
  const internal = edgesWithBothEndsIn(body.edges, fixture.copyNodeIds);
  assert.deepEqual(internal, [fixture.internalEdgeId]);
  assert.equal(internal.includes(fixture.externalEdgeId), false);
  const empty = createEmptyProject({
    projectId: "open",
    name: "当前工程",
    now: new Date("2026-09-24T00:00:00.000Z"),
  });
  const onto = new EditorStore({
    idFactory: () => "n",
    now: () => new Date("2026-09-24T00:00:00.000Z"),
  });
  onto.loadProject(empty);
  applyFixtureToStore(onto, fixture.project);
  assert.equal(onto.getSnapshot().nodes.length, 3);
  assert.equal(onto.getSnapshot().unsaved, true);
  assert.equal(onto.getSnapshot().needsWorkingCopySync, true);
});

test("预置 webp 的 SHA-256 为小写 64 位，路径正斜杠，原件不当预览", () => {
  assert.match(FIXTURE_WEBP_SHA256, /^[0-9a-f]{64}$/);
  assert.equal(FIXTURE_WEBP_SHA256, FIXTURE_WEBP_SHA256.toLowerCase());
  const digest = createHash("sha256").update(FIXTURE_WEBP_BYTES).digest("hex");
  assert.equal(digest, FIXTURE_WEBP_SHA256);
  const blob = fixtureBlobRelPath();
  const thumb = fixtureThumbRelPath();
  assert.equal(blob.includes("\\"), false);
  assert.equal(thumb.includes("\\"), false);
  assert.equal(blob.startsWith("/"), false);
  assert.equal(thumb.startsWith("/"), false);
  assert.equal(isValidProjectRelPath(blob), true);
  assert.equal(isValidProjectRelPath(thumb), true);
  assert.equal(blob, `media/blobs/${FIXTURE_WEBP_SHA256.slice(0, 2)}/${FIXTURE_WEBP_SHA256}.blob`);
  assert.equal(
    thumb,
    `media/derived/${FIXTURE_WEBP_SHA256.slice(0, 2)}/${FIXTURE_WEBP_SHA256}/${THUMB_WEBP_LONGEDGE_512_V1}/${FIXTURE_WEBP_SHA256}.webp`,
  );
  const ref = fixtureImageMediaRef();
  assert.equal(ref.relativePath, blob);
  assert.equal(ref.thumbRelativePath, thumb);
  assert.notEqual(ref.thumbRelativePath, ref.relativePath);
  assert.equal(ref.contentHash, FIXTURE_WEBP_SHA256);
  const twenty = generateTwentyFixture();
  const validated = validateProject(twenty);
  assert.equal(validated.ok, true);
  for (const node of Object.values(twenty.nodes)) {
    if (node.kind !== "image" || node.output === undefined || node.output === null) {
      continue;
    }
    assert.equal(node.output.relativePath.includes("\\"), false);
    assert.equal(node.output.thumbRelativePath?.includes("\\"), false);
    assert.notEqual(node.output.thumbRelativePath, node.output.relativePath);
  }
  const overlap = createOverlapFixture();
  assert.equal(overlap.overlapWorld.x, overlap.project.nodes[overlap.generationNodeId]?.x);
  assert.ok(overlap.project.groups[overlap.groupId]);
  const json = JSON.stringify(twenty);
  assert.equal(json.includes("data:"), false);
});

test("copyFixtureMediaIntoProject 把 blob 与 derived thumb 写入工程 media/", async () => {
  const dir = await mkdtemp(join(tmpdir(), "canvas-fixture-media-"));
  try {
    const installed = await copyFixtureMediaIntoProject(dir);
    assert.equal(installed.contentHash, FIXTURE_WEBP_SHA256);
    assert.equal(installed.blobRelPath.includes("\\"), false);
    assert.equal(installed.thumbRelPath.includes("\\"), false);
    assert.equal(isValidProjectRelPath(installed.blobRelPath), true);
    assert.equal(isValidProjectRelPath(installed.thumbRelPath), true);
    const blobBytes = await readFile(join(dir, ...installed.blobRelPath.split("/")));
    const thumbBytes = await readFile(join(dir, ...installed.thumbRelPath.split("/")));
    assert.deepEqual(blobBytes, Buffer.from(FIXTURE_WEBP_BYTES));
    assert.deepEqual(thumbBytes, Buffer.from(FIXTURE_WEBP_BYTES));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("生产入口没有无条件 import 加载 1000 节点按钮", () => {
  const app = readFileSync(join(srcRoot, "App.tsx"), "utf8");
  const main = readFileSync(join(srcRoot, "main.tsx"), "utf8");
  assert.equal(app.includes("fixtures"), false);
  assert.equal(main.includes("fixtures"), false);
  assert.equal(app.includes(LOAD_THOUSAND_LABEL), false);
  assert.equal(main.includes(LOAD_THOUSAND_LABEL), false);
  assert.equal(app.includes("generateThousandFarFixture"), false);
  assert.equal(main.includes("DevFixtureBar"), false);
});
