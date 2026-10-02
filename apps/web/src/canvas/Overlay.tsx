import type { ReactElement } from "react";
import { COPY } from "../ui/copy.ts";

export function Overlay(props: {
  selectedCount: number;
  marqueeRef: { current: HTMLDivElement | null };
  guidesRef: { current: HTMLDivElement | null };
  connectMessage?: string | null;
}): ReactElement {
  return (
    <div className="canvas-overlay" aria-hidden="false">
      <div ref={(el) => {
        props.marqueeRef.current = el;
      }} className="marquee" hidden />
      <div
        ref={(el) => {
          props.guidesRef.current = el;
        }}
        className="align-guides"
      />
      <div className="selection-status" data-selection-status="true">
        {COPY.selectedCount(props.selectedCount)}
      </div>
      {props.connectMessage != null && props.connectMessage !== "" ? (
        <div className="connect-message" data-connect-message="true">
          {props.connectMessage}
        </div>
      ) : null}
    </div>
  );
}

export function applyAlignGuides(
  el: HTMLDivElement | null,
  lines: { axis: "x" | "y"; pos: number }[] | null,
  viewportHeight: number,
  viewportWidth: number,
): void {
  if (el === null) {
    return;
  }
  el.replaceChildren();
  if (lines === null || lines.length === 0) {
    return;
  }
  for (const line of lines) {
    const mark = document.createElement("div");
    mark.className = "align-guide";
    if (line.axis === "x") {
      mark.style.transform = `translate3d(${line.pos}px, 0, 0)`;
      mark.style.width = "1px";
      mark.style.height = `${viewportHeight}px`;
    } else {
      mark.style.transform = `translate3d(0, ${line.pos}px, 0)`;
      mark.style.width = `${viewportWidth}px`;
      mark.style.height = "1px";
    }
    el.appendChild(mark);
  }
}

export function applyMarqueeRect(
  el: HTMLDivElement | null,
  rect: { x: number; y: number; width: number; height: number } | null,
): void {
  if (el === null) {
    return;
  }
  if (rect === null || rect.width < 1 && rect.height < 1) {
    el.hidden = true;
    return;
  }
  el.hidden = false;
  el.style.transform = `translate3d(${rect.x}px, ${rect.y}px, 0)`;
  el.style.width = `${rect.width}px`;
  el.style.height = `${rect.height}px`;
}
