import { useState, type FormEvent, type ReactElement } from "react";
import { COPY } from "./copy.ts";

export function SaveAsForm(props: {
  busy: boolean;
  error: string | null;
  disabled: boolean;
  disabledReason: string | null;
  onSubmit: (parentDir: string, name: string) => void;
  onCancel: () => void;
}): ReactElement {
  const [parentDir, setParentDir] = useState("");
  const [name, setName] = useState("");
  const ready = parentDir.trim().length > 0 && name.trim().length > 0;

  const handleSubmit = (event: FormEvent): void => {
    event.preventDefault();
    if (props.disabled || props.busy || !ready) {
      return;
    }
    props.onSubmit(parentDir.trim(), name.trim());
  };

  return (
    <form className="path-form" onSubmit={handleSubmit}>
      <p className="page-hint">{COPY.saveAsHint}</p>
      <label className="field">
        <span>{COPY.parentDir}</span>
        <input
          type="text"
          autoComplete="off"
          spellCheck={false}
          value={parentDir}
          onChange={(event) => {
            setParentDir(event.target.value);
          }}
        />
      </label>
      <label className="field">
        <span>{COPY.projectName}</span>
        <input
          type="text"
          autoComplete="off"
          spellCheck={false}
          value={name}
          onChange={(event) => {
            setName(event.target.value);
          }}
        />
      </label>
      {props.error !== null ? (
        <p className="form-error" role="alert">
          {props.error}
        </p>
      ) : null}
      {props.disabled && props.disabledReason !== null ? (
        <p className="field-reason">{props.disabledReason}</p>
      ) : null}
      <div className="btn-row">
        <button
          type="submit"
          className="btn btn-primary"
          disabled={props.disabled || props.busy || !ready}
        >
          {COPY.submitSaveAs}
        </button>
        <button type="button" className="btn btn-secondary" onClick={props.onCancel} disabled={props.busy}>
          {COPY.cancel}
        </button>
      </div>
    </form>
  );
}
