import type { ReactElement } from "react";
import { COPY } from "../ui/copy.ts";

export function Overlay(props: {
  selectedCount: number;
  marqueeRef: { current: HTMLDivElement | null };
  connectMessage?: string | null;
}): ReactElement {
  return (
    <div className="canvas-overlay" aria-hidden="false">
      <div ref={(el) => {
        props.marqueeRef.current = el;
      }} className="marquee" hidden />
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
