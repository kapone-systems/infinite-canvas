import type { ReactElement } from "react";
import { COPY } from "./copy.ts";

export function EmptyCanvasState(props: { onAddText: () => void }): ReactElement {
  return (
    <div className="empty-canvas" data-empty>
      <h1 className="page-title">{COPY.emptyCanvas}</h1>
      <p className="page-hint">{COPY.emptyCanvasHint}</p>
      <button type="button" className="btn btn-primary" onClick={props.onAddText}>
        {COPY.addTextNode}
      </button>
    </div>
  );
}

export function NoProjectState(props: {
  onNew: () => void;
  onOpen: () => void;
}): ReactElement {
  return (
    <div className="no-project">
      <h1 className="page-title">{COPY.noProject}</h1>
      <div className="btn-row">
        <button type="button" className="btn btn-primary" onClick={props.onNew}>
          {COPY.newProject}
        </button>
        <button type="button" className="btn btn-secondary" onClick={props.onOpen}>
          {COPY.openProject}
        </button>
      </div>
    </div>
  );
}
