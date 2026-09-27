import type { RunEvent } from "@canvas/schema";
import { EXECUTION_RUNS_PATH } from "./client.ts";

export const WS_BEARER_PROTOCOL = "canvas-bearer";

export function runEventsUrl(
  runId: string,
  location: { protocol: string; host: string },
): string {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${location.host}${EXECUTION_RUNS_PATH}/${encodeURIComponent(runId)}/events`;
}

export function runEventsProtocols(token: string): string[] {
  return [WS_BEARER_PROTOCOL, `${WS_BEARER_PROTOCOL}.${token}`];
}

export function parseRunEvent(raw: string): RunEvent | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== "object" || !("type" in parsed)) {
      return null;
    }
    const type = (parsed as { type: unknown }).type;
    if (typeof type !== "string" || !type.includes(".")) {
      return null;
    }
    return parsed as RunEvent;
  } catch {
    return null;
  }
}

export function subscribeRunEvents(options: {
  runId: string;
  token: string;
  location: { protocol: string; host: string };
  onEvent: (event: RunEvent) => void;
}): () => void {
  const Ctor = (globalThis as { WebSocket?: typeof WebSocket }).WebSocket;
  if (typeof Ctor !== "function") {
    return () => undefined;
  }
  const url = runEventsUrl(options.runId, options.location);
  const socket = new Ctor(url, runEventsProtocols(options.token));
  socket.addEventListener("message", (event: MessageEvent<string>) => {
    if (typeof event.data !== "string") {
      return;
    }
    const parsed = parseRunEvent(event.data);
    if (parsed !== null) {
      options.onEvent(parsed);
    }
  });
  return () => {
    socket.close();
  };
}
