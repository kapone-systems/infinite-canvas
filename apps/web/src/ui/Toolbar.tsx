import { useState, type ReactElement } from "react";
import { listCapabilities } from "@canvas/schema";
import { COPY, unimplementedCapabilityClick } from "./copy.ts";

export function Toolbar(props: {
  onAddText: () => void;
  onAddGeneration?: (profileId: string) => void;
  disabled: boolean;
  disabledReason: string | null;
}): ReactElement {
  const implemented = listCapabilities().filter((item) => item.implemented);
  const later = listCapabilities().filter((item) => !item.implemented);
  const [laterNotice, setLaterNotice] = useState<string | null>(null);
  return (
    <aside className="toolbar" aria-label={COPY.textKindLabel}>
      <button
        type="button"
        className="btn btn-secondary toolbar-btn"
        data-profile-id="text"
        onClick={props.onAddText}
        disabled={props.disabled}
      >
        {COPY.textKindLabel}
      </button>
      {implemented.map((item) => (
        <button
          key={item.profileId}
          type="button"
          className="btn btn-secondary toolbar-btn"
          data-profile-id={item.profileId}
          disabled={props.disabled}
          onClick={() => {
            props.onAddGeneration?.(item.profileId);
          }}
        >
          {item.displayName}
        </button>
      ))}
      {later.length > 0 ? (
        <div className="toolbar-later">
          <p className="toolbar-later-title">{COPY.laterTitle}</p>
          {later.map((item) => (
            <button
              key={item.profileId}
              type="button"
              className="btn btn-secondary toolbar-btn is-unavailable"
              data-profile-id={item.profileId}
              data-later=""
              aria-disabled="true"
              title={COPY.notImplemented}
              onClick={() => {
                const result = unimplementedCapabilityClick();
                setLaterNotice(result.message);
              }}
            >
              {item.displayName}
            </button>
          ))}
          <p className="field-reason" data-later-notice="">
            {laterNotice ?? COPY.notImplemented}
          </p>
        </div>
      ) : null}
      {props.disabled && props.disabledReason !== null ? (
        <p className="field-reason">{props.disabledReason}</p>
      ) : null}
    </aside>
  );
}
