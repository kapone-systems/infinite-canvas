/// <reference types="node" />
import assert from "node:assert/strict";
import { test } from "node:test";
import type { Camera } from "@canvas/schema";
import { farTitleVisible, isFar, isMid, isNear, lodBand, pickMountedIds, planLod } from "./lod.ts";
import {
  FAR_TITLE_MIN_SCREEN_PX,
  LOD_FAR,
  LOD_NEAR,
  MOUNT_CAP,
  THUMB_CAP,
} from "./metrics.ts";

const VIEW = { width: 1280, height: 720 };
const CAMERA: Camera = { x: 0, y: 0, zoom: 1 };

test("远 < 0.3、中 0.3–0.8、近 ≥ 0.8", () => {
  assert.equal(LOD_FAR, 0.3);
  assert.equal(LOD_NEAR, 0.8);
  assert.equal(lodBand(0.29), "far");
  assert.equal(lodBand(0.3), "mid");
  assert.equal(lodBand(0.79), "mid");
  assert.equal(lodBand(0.8), "near");
  assert.equal(lodBand(1), "near");
  assert.equal(isFar(0.29), true);
  assert.equal(isMid(0.5), true);
  assert.equal(isNear(0.8), true);
  assert.equal(isNear(0.79), false);
});

test("远景 / 中景不挂外壳、不加载缩略图，视口内全是色块", () => {
  const nodes = Array.from({ length: 8 }, (_, i) => ({
    id: `n${i}`,
    x: i * 40 - 80,
    y: 0,
    width: 30,
    height: 30,
    hasThumb: true,
  }));
  const far = planLod({ camera: { x: 0, y: 0, zoom: 0.2 }, viewport: VIEW, nodes });
  assert.equal(far.band, "far");
  assert.deepEqual(far.mountedIds, []);
  assert.deepEqual(far.thumbIds, []);
  assert.ok(far.blockIds.length > 0);
  const mid = planLod({ camera: { x: 0, y: 0, zoom: 0.5 }, viewport: VIEW, nodes });
  assert.equal(mid.band, "mid");
  assert.deepEqual(mid.mountedIds, []);
  assert.deepEqual(mid.thumbIds, []);
  assert.deepEqual(
    pickMountedIds({ camera: { x: 0, y: 0, zoom: 0.79 }, viewport: VIEW, nodes }),
    [],
  );
});

test("近景挂载完整外壳硬顶 120", () => {
  assert.equal(MOUNT_CAP, 120);
  const nodes = Array.from({ length: 150 }, (_, i) => ({
    id: `m${String(i).padStart(3, "0")}`,
    x: (i % 20) * 40 - 400,
    y: Math.floor(i / 20) * 40 - 200,
    width: 24,
    height: 24,
  }));
  const plan = planLod({ camera: CAMERA, viewport: VIEW, nodes });
  assert.equal(plan.band, "near");
  assert.equal(plan.mountedIds.length, 120);
  assert.equal(plan.blockIds.length, 30);
  assert.equal(pickMountedIds({ camera: CAMERA, viewport: VIEW, nodes }).length, 120);
  for (const id of plan.mountedIds) {
    assert.equal(plan.blockIds.includes(id), false);
  }
});

test("视口内带缩略图节点目标 ≤ 40，再多边缘降成色块", () => {
  assert.equal(THUMB_CAP, 40);
  const nodes = Array.from({ length: 50 }, (_, i) => ({
    id: `t${String(i).padStart(2, "0")}`,
    x: i * 12 - 40,
    y: 0,
    width: 10,
    height: 10,
    hasThumb: true,
  }));
  const plan = planLod({ camera: CAMERA, viewport: VIEW, nodes });
  assert.equal(plan.thumbIds.length, 40);
  assert.equal(plan.mountedIds.length, 40);
  assert.equal(plan.blockIds.length, 10);
  const farthest = nodes[49];
  assert.ok(farthest);
  assert.equal(plan.thumbIds.includes(farthest.id), false);
  assert.equal(plan.blockIds.includes(farthest.id), true);
  const closest = nodes[0];
  assert.ok(closest);
  assert.equal(plan.thumbIds.includes(closest.id), true);
  assert.equal(plan.mountedIds.includes(closest.id), true);
});

test("远景色块屏幕宽度 ≥ 64 才画标题", () => {
  assert.equal(FAR_TITLE_MIN_SCREEN_PX, 64);
  assert.equal(farTitleVisible(320, 0.2), true);
  assert.equal(farTitleVisible(320, 0.19), false);
});
