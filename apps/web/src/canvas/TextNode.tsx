import { useEffect, useRef, type ReactElement } from "react";
import type { ProjectNode } from "@canvas/schema";
import type { SetTextResult } from "./EditorStore.ts";
import { COPY } from "../ui/copy.ts";
import { createImeTracker, shouldCommitTextCommand } from "./ime.ts";
import { applyFocusedTextHistoryKey } from "./shortcuts.ts";

export function TextNodeView(props: {
  node: ProjectNode;
  editing: boolean;
  onCommit: (text: string) => SetTextResult;
  onComposingChange: (composing: boolean) => void;
  onFocusChange: (focused: boolean) => void;
  onUndo: () => void;
  onRedo: () => void;
}): ReactElement {
  const imeRef = useRef(createImeTracker());
  const valueRef = useRef(props.node.text ?? "");
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const text = props.node.text ?? "";

  useEffect(() => {
    const next = props.node.text ?? "";
    if (!imeRef.current.isComposing() && valueRef.current !== next) {
      valueRef.current = next;
      const el = areaRef.current;
      if (el !== null && el.value !== next) {
        el.value = next;
      }
    }
  }, [props.node.text]);

  useEffect(() => {
    if (props.editing) {
      areaRef.current?.focus();
    }
  }, [props.editing]);

  const commit = (next: string): void => {
    if (!shouldCommitTextCommand(imeRef.current.isComposing())) {
      return;
    }
    const result = props.onCommit(next);
    if (!result.ok) {
      const revert = props.node.text ?? "";
      valueRef.current = revert;
      const el = areaRef.current;
      if (el !== null) {
        el.value = revert;
      }
    }
  };

  if (!props.editing) {
    return (
      <div className="text-node-preview" data-preview="text">
        {text.length > 0 ? text : COPY.emptyText}
      </div>
    );
  }

  return (
    <textarea
      ref={areaRef}
      className="text-node-input"
      defaultValue={text}
      placeholder={COPY.emptyText}
      aria-label={COPY.textKindLabel}
      onFocus={() => {
        props.onFocusChange(true);
      }}
      onBlur={() => {
        props.onFocusChange(false);
      }}
      onKeyDown={(event) => {
        applyFocusedTextHistoryKey(event, {
          composing: imeRef.current.isComposing(),
          undo: props.onUndo,
          redo: props.onRedo,
        });
      }}
      onCompositionStart={() => {
        imeRef.current.start();
        props.onComposingChange(true);
      }}
      onCompositionEnd={(event) => {
        imeRef.current.end();
        props.onComposingChange(false);
        valueRef.current = event.currentTarget.value;
        commit(event.currentTarget.value);
      }}
      onInput={(event) => {
        valueRef.current = event.currentTarget.value;
        if (shouldCommitTextCommand(imeRef.current.isComposing())) {
          commit(event.currentTarget.value);
        }
      }}
    />
  );
}
