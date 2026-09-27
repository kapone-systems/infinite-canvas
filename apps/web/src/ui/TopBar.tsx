import type { ReactElement } from "react";
import { COPY } from "./copy.ts";

export function TopBar(props: {
  projectName: string | null;
  unsaved: boolean;
  canSave: boolean;
  saveDisabledReason: string | null;
  canSaveAs: boolean;
  saveAsDisabledReason: string | null;
  onSave: () => void;
  onSaveAs: () => void;
  onSettings?: () => void;
}): ReactElement {
  return (
    <header className="topbar">
      <div className="topbar-title">{props.projectName ?? COPY.noProject}</div>
      <div className="topbar-status">
        {props.unsaved ? <span className="unsaved-flag">{COPY.unsaved}</span> : null}
      </div>
      <div className="topbar-actions">
        <div className="btn-with-reason">
          <button
            type="button"
            className="btn btn-primary"
            onClick={props.onSave}
            disabled={!props.canSave}
          >
            {COPY.save}
          </button>
          {!props.canSave && props.saveDisabledReason !== null ? (
            <span className="field-reason">{props.saveDisabledReason}</span>
          ) : null}
        </div>
        <div className="btn-with-reason">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={props.onSaveAs}
            disabled={!props.canSaveAs}
          >
            {COPY.saveAs}
          </button>
          {!props.canSaveAs && props.saveAsDisabledReason !== null ? (
            <span className="field-reason">{props.saveAsDisabledReason}</span>
          ) : null}
        </div>
        {props.onSettings !== undefined ? (
          <button type="button" className="btn btn-secondary" onClick={props.onSettings}>
            {COPY.settings}
          </button>
        ) : null}
      </div>
    </header>
  );
}
