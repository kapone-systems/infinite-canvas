import assert from "node:assert/strict";
import { test } from "node:test";
import { decodePngRgba, encodePngRgba } from "./png.ts";
import { decodeWebpLossless, encodeWebpLossless } from "./webpLossless.ts";
import { scaleRgba } from "./thumb.ts";

test("手写 PNG 编解码 roundtrip", () => {
  const rgba = new Uint8Array([10, 20, 30, 255, 40, 50, 60, 128]);
  const png = encodePngRgba(2, 1, rgba);
  const decoded = decodePngRgba(png);
  assert.equal(decoded.width, 2);
  assert.equal(decoded.height, 1);
  assert.deepEqual(Buffer.from(decoded.rgba), Buffer.from(rgba));
});

test("VP8L 1×1 与 2×2 roundtrip", () => {
  const one = new Uint8Array([255, 0, 0, 255]);
  const webp = encodeWebpLossless(1, 1, one);
  assert.equal(webp.subarray(0, 4).toString("ascii"), "RIFF");
  assert.equal(webp.subarray(8, 12).toString("ascii"), "WEBP");
  assert.equal(webp.subarray(12, 16).toString("ascii"), "VP8L");
  const decoded = decodeWebpLossless(webp);
  assert.equal(decoded.width, 1);
  assert.equal(decoded.height, 1);
  assert.deepEqual(Buffer.from(decoded.rgba), Buffer.from(one));

  const four = new Uint8Array([
    255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 10, 20, 30, 40,
  ]);
  const webp2 = encodeWebpLossless(2, 2, four);
  const decoded2 = decodeWebpLossless(webp2);
  assert.equal(decoded2.width, 2);
  assert.equal(decoded2.height, 2);
  assert.deepEqual(Buffer.from(decoded2.rgba), Buffer.from(four));
});

test("缩略图缩放不放大，长边最多 512", () => {
  const small = scaleRgba(10, 20, new Uint8Array(10 * 20 * 4).fill(7), 512);
  assert.equal(small.width, 10);
  assert.equal(small.height, 20);
  const big = scaleRgba(1024, 256, new Uint8Array(1024 * 256 * 4).fill(9), 512);
  assert.equal(big.width, 512);
  assert.equal(big.height, 128);
});
