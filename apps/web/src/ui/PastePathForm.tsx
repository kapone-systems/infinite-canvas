import { useState, type FormEvent, type ReactElement } from "react";
import { COPY } from "./copy.ts";

export function PastePathForm(props: {
  mode: "create" | "open";
  busy: boolean;
  error: string | null;
  disabled: boolean;
  onSubmitCreate: (parentDir: string, name: string) => void;
  onSubmitOpen: (absolutePath: string) => void;
  onCancel: () => void;
}): ReactElement {
  const [parentDir, setParentDir] = useState("");
  const [name, setName] = useState("");
  const [absolutePath, setAbsolutePath] = useState("");

  const handleSubmit = (event: FormEvent): void => {
    event.preventDefault();
    if (props.disabled || props.busy) {
      return;
    }
    if (props.mode === "create") {
      props.onSubmitCreate(parentDir.trim(), name.trim());
      return;
    }
    props.onSubmitOpen(absolutePath.trim());
  };

  const createReady = parentDir.trim().length > 0 && name.trim().length > 0;
  const openReady = absolutePath.trim().length > 0;
  const canSubmit = props.mode === "create" ? createReady : openReady;

  return (
    <form className="path-form" onSubmit={handleSubmit}>
      <p className="page-hint">{props.mode === "create" ? COPY.createPathHint : COPY.openPathHint}</p>
      {props.mode === "create" ? (
        <>
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
        </>
      ) : (
        <label className="field">
          <span>{COPY.projectFolder}</span>
          <input
            type="text"
            autoComplete="off"
            spellCheck={false}
            value={absolutePath}
            onChange={(event) => {
              setAbsolutePath(event.target.value);
            }}
          />
        </label>
      )}
      {props.error !== null ? (
        <p className="form-error" role="alert">
          {props.error}
        </p>
      ) : null}
      {props.disabled ? <p className="field-reason">{COPY.backendDisconnected}</p> : null}
      <div className="btn-row">
        <button
          type="submit"
          className="btn btn-primary"
          disabled={props.disabled || props.busy || !canSubmit}
        >
          {props.mode === "create" ? COPY.submitCreate : COPY.submitOpen}
        </button>
        <button type="button" className="btn btn-secondary" onClick={props.onCancel} disabled={props.busy}>
          {COPY.cancel}
        </button>
      </div>
    </form>
  );
}
