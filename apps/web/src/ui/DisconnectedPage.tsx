import type { ReactElement } from "react";
import { COPY } from "./copy.ts";

export function DisconnectedPage(props: { onRetry: () => void }): ReactElement {
  return (
    <main className="page-center">
      <h1 className="page-title">{COPY.backendNeverConnected}</h1>
      <button type="button" className="btn btn-primary" onClick={props.onRetry}>
        {COPY.retryConnection}
      </button>
    </main>
  );
}

export function ConnectingPage(): ReactElement {
  return (
    <main className="page-center" aria-busy="true" aria-live="polite">
      <div className="loading-mark" aria-hidden="true" />
      <p className="page-title">{COPY.connecting}</p>
    </main>
  );
}
