/// <reference types="node" />
import assert from "node:assert/strict";
import { test } from "node:test";
import { CELL, GRID } from "./metrics.ts";
import { createSpatialIndex, rectsIntersect } from "./spatialIndex.ts";

test("格子 512：同一格内精确矩形过滤，不会把同格其他 id 查出来", () => {
  const index = createSpatialIndex();
  index.insert("a", { x: 0, y: 0, width: 20, height: 20 });
  index.insert("b", { x: 400, y: 400, width: 20, height: 20 });
  assert.equal(CELL, 512);
  assert.equal(GRID, 512);
  assert.deepEqual(index.query({ x: 0, y: 0, width: 30, height: 30 }), ["a"]);
  assert.deepEqual(index.query({ x: 390, y: 390, width: 40, height: 40 }), ["b"]);
  assert.deepEqual(index.query({ x: 100, y: 100, width: 10, height: 10 }), []);
});

test("query 按世界矩形查出覆盖多格的 id", () => {
  const index = createSpatialIndex();
  index.insert("span", { x: 500, y: 500, width: 40, height: 40 });
  index.insert("far", { x: 2000, y: 0, width: 10, height: 10 });
  assert.ok(rectsIntersect({ x: 500, y: 500, width: 40, height: 40 }, { x: 510, y: 510, width: 10, height: 10 }));
  assert.deepEqual(index.query({ x: 510, y: 510, width: 10, height: 10 }), ["span"]);
  assert.deepEqual(index.query({ x: 0, y: 0, width: 400, height: 400 }), []);
  assert.deepEqual(index.query({ x: 0, y: 0, width: 3000, height: 600 }), ["far", "span"]);
});

test("insert 同一 id 会更新矩形；remove / clear 后查不到", () => {
  const index = createSpatialIndex();
  index.insert("n", { x: 0, y: 0, width: 10, height: 10 });
  index.insert("n", { x: 800, y: 0, width: 10, height: 10 });
  assert.deepEqual(index.query({ x: 0, y: 0, width: 20, height: 20 }), []);
  assert.deepEqual(index.query({ x: 795, y: 0, width: 20, height: 20 }), ["n"]);
  index.remove("n");
  assert.deepEqual(index.query({ x: 795, y: 0, width: 20, height: 20 }), []);
  index.insert("a", { x: 0, y: 0, width: 5, height: 5 });
  index.insert("b", { x: 1, y: 1, width: 5, height: 5 });
  index.clear();
  assert.deepEqual(index.query({ x: -10, y: -10, width: 40, height: 40 }), []);
});

test("负坐标格子也能按世界矩形查出", () => {
  const index = createSpatialIndex();
  index.insert("neg", { x: -600, y: -20, width: 30, height: 30 });
  assert.deepEqual(index.query({ x: -610, y: -25, width: 20, height: 20 }), ["neg"]);
  assert.deepEqual(index.query({ x: 0, y: 0, width: 10, height: 10 }), []);
});
