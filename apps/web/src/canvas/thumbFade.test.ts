import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { farNodeId, farNodePosition, generateHundredFixture } from "../fixtures/generate.ts";
import { fixtureThumbRelPath, freshGeneratedThumbRelPath } from "../fixtures/media.ts";

const here = dirname(fileURLToPath(import.meta.url));

test("一百夹具原坐标和预置缩略图还在，并多一张刚生成缩略图；淡入 180ms，拖拽跳终态", () => {
  const fixture = generateHundredFixture();
  assert.equal(Object.keys(fixture.nodes).length, 100);
  const fresh = fixture.nodes[farNodeId(2)];
  assert.ok(fresh);
  const pos = farNodePosition(2, 20260924);
  assert.equal(fresh.x, pos.x);
  assert.equal(fresh.y, pos.y);
  assert.equal(fresh.output?.thumbRelativePath, freshGeneratedThumbRelPath());
  const preset = Object.values(fixture.nodes).find(
    (node) => node.kind === "image" && node.output?.thumbRelativePath === fixtureThumbRelPath(),
  );
  assert.ok(preset);
  assert.notEqual(preset.x, undefined);
  const css = readFileSync(join(here, "../styles.css"), "utf8");
  const fade = cssRule(css, ".thumb-image {");
  assert.equal(fade.includes("thumb-fade-in 180ms"), true);
  const jump = cssRule(css, '.canvas-host[data-gesture-active="true"] .thumb-image {');
  assert.match(jump, /animation:\s*none/);
  assert.match(jump, /opacity:\s*1/);
  const app = readFileSync(join(here, "../App.tsx"), "utf8");
  assert.equal(app.includes("data-gesture-active={snap.gestureActive"), true);
});

function cssRule(css: string, header: string): string {
  const start = css.indexOf(header);
  assert.equal(start >= 0, true);
  const open = css.indexOf("{", start);
  const close = css.indexOf("}", open);
  assert.equal(open >= 0 && close > open, true);
  return css.slice(open + 1, close);
}
