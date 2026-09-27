import { DECODE_CAP } from "./metrics.ts";

type Waiter = () => void;

let inflight = 0;
const waiters: Waiter[] = [];

export function acquireDecodeSlot(): Promise<() => void> {
  return new Promise((resolve) => {
    const grant = (): void => {
      inflight += 1;
      let released = false;
      resolve(() => {
        if (released) {
          return;
        }
        released = true;
        inflight -= 1;
        const next = waiters.shift();
        if (next !== undefined) {
          next();
        }
      });
    };
    if (inflight < DECODE_CAP) {
      grant();
      return;
    }
    waiters.push(grant);
  });
}

export function decodeCap(): number {
  return DECODE_CAP;
}
