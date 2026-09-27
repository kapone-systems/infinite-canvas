import type { RunEvent } from "@canvas/schema";

type Listener = (event: RunEvent) => void;

/**
 * 进程内 RunEvent 订阅。WS 只订后续；历史靠 GET RunSnapshot。
 */
export class EventHub {
  private readonly listeners = new Map<string, Set<Listener>>();

  publish(event: RunEvent): void {
    const runId = event.runId;
    if (runId === null) {
      return;
    }
    for (const listener of this.listeners.get(runId) ?? []) {
      listener(event);
    }
  }

  subscribe(runId: string, listener: Listener): () => void {
    let set = this.listeners.get(runId);
    if (set === undefined) {
      set = new Set();
      this.listeners.set(runId, set);
    }
    set.add(listener);
    return () => {
      set.delete(listener);
      if (set.size === 0) {
        this.listeners.delete(runId);
      }
    };
  }

  async *iterate(runId: string, signal?: AbortSignal): AsyncIterable<RunEvent> {
    const queue: RunEvent[] = [];
    let notify: (() => void) | null = null;
    const unsub = this.subscribe(runId, (event) => {
      queue.push(event);
      notify?.();
    });
    const onAbort = (): void => {
      notify?.();
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    try {
      while (signal === undefined || !signal.aborted) {
        if (queue.length === 0) {
          await new Promise<void>((resolve) => {
            notify = resolve;
          });
          notify = null;
          if (signal?.aborted) {
            return;
          }
        }
        const next = queue.shift();
        if (next !== undefined) {
          yield next;
        }
      }
    } finally {
      unsub();
      signal?.removeEventListener("abort", onAbort);
    }
  }

  dispose(): void {
    this.listeners.clear();
  }
}
