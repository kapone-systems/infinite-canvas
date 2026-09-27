import assert from "node:assert/strict";
import { test } from "node:test";
import { consumeViewerWheel } from "./viewerWheel.ts";
import { applyWheelZoom, wheelShouldZoom } from "./gestures.ts";

test("查看大图吃掉滚轮，并且不改相机", () => {
  const calls: string[] = [];
  consumeViewerWheel({
    preventDefault: () => {
      calls.push("prevent");
    },
    stopPropagation: () => {
      calls.push("stop");
    },
  });
  assert.deepEqual(calls, ["prevent", "stop"]);
  const camera = { x: 4, y: 8, zoom: 1 };
  const next = wheelShouldZoom({ composing: false, editable: false, viewerOpen: true })
    ? applyWheelZoom(camera, { x: 12, y: 12 }, { width: 400, height: 300 }, -80)
    : camera;
  assert.equal(next.x, 4);
  assert.equal(next.y, 8);
  assert.equal(next.zoom, 1);
});
