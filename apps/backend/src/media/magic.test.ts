import assert from "node:assert/strict";
import { test } from "node:test";
import { looksLikeSvg, sniffMagic } from "./magic.ts";
import { encodePngRgba } from "./png.ts";

test("PNG 魔数与尺寸", () => {
  const png = encodePngRgba(2, 1, new Uint8Array([255, 0, 0, 255, 0, 255, 0, 255]));
  const sniff = sniffMagic(png);
  assert.equal(sniff.magic, "png");
  assert.equal(sniff.kind, "image");
  assert.equal(sniff.mimeDetected, "image/png");
  assert.equal(sniff.width, 2);
  assert.equal(sniff.height, 1);
  assert.equal(sniff.svg, false);
});

test("SVG 文本拒绝", () => {
  const svg = Buffer.from(`<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"></svg>`);
  assert.equal(looksLikeSvg(svg), true);
  const sniff = sniffMagic(svg);
  assert.equal(sniff.svg, true);
  assert.equal(sniff.magic, "svg");
  assert.equal(sniff.matched, false);
});

test("裸 <svg 也拒绝", () => {
  const sniff = sniffMagic(Buffer.from(`<svg width="1" height="1"></svg>`));
  assert.equal(sniff.svg, true);
});

test("WebP RIFF 魔数", () => {
  const bytes = Buffer.from("UklGRiQAAABXRUJQVlA4IBgAAAAwAQCdASoBAAEAAwA0JaQAA3AA/vuUAAA=", "base64");
  const sniff = sniffMagic(bytes);
  assert.equal(sniff.magic, "webp");
  assert.equal(sniff.kind, "image");
  assert.equal(sniff.width, 1);
  assert.equal(sniff.height, 1);
});
