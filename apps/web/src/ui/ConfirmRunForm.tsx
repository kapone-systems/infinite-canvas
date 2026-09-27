import type { FormEvent, ReactElement } from "react";
import { COPY } from "./copy.ts";

export function ConfirmRunForm(props: {
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
}): ReactElement {
  const handleSubmit = (event: FormEvent): void => {
    event.preventDefault();
    props.onConfirm();
  };

  return (
    <form className="path-form" onSubmit={handleSubmit} data-confirm-run="true">
      <p className="page-hint">{props.message}</p>
      <div className="btn-row">
        <button type="submit" className="btn btn-primary">
          {COPY.runConfirmAction}
        </button>
        <button type="button" className="btn btn-secondary" onClick={props.onCancel}>
          {COPY.cancel}
        </button>
      </div>
    </form>
  );
}
