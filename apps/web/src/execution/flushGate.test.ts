import assert from "node:assert/strict";
import { test } from "node:test";
import { createFlushGate } from "./flushGate.ts";

test("后一次同步等进行中的那次结束，不会立刻失败", async () => {
  const gate = createFlushGate();
  const order: string[] = [];
  let release: () => void = () => undefined;
  const first = gate.run(
    () =>
      new Promise((resolve) => {
        order.push("start");
        release = () => {
          order.push("end");
          resolve(true);
        };
      }),
  );
  const second = gate.run(async () => {
    order.push("second");
    return true;
  });
  assert.deepEqual(order, ["start"]);
  release();
  assert.equal(await first, true);
  assert.equal(await second, true);
  assert.deepEqual(order, ["start", "end", "second"]);
});
