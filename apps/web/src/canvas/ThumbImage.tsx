import { useEffect, useRef, useState, type ReactElement } from "react";
import { requestMediaTicket } from "../api/client.ts";
import { COPY } from "../ui/copy.ts";
import { acquireDecodeSlot } from "./decodeQueue.ts";
import { resolveThumbSrc } from "./thumbSrc.ts";

export function ThumbFailed(props: { onRetry?: () => void }): ReactElement {
  return (
    <div className="thumb-failed">
      <div className="thumb-block" aria-hidden="true" />
      <p className="thumb-failed-msg">{COPY.thumbFailed}</p>
      {props.onRetry !== undefined ? (
        <button type="button" className="btn btn-secondary" onClick={props.onRetry}>
          {COPY.thumbRetry}
        </button>
      ) : (
        <button type="button" className="btn btn-secondary" disabled>
          {COPY.thumbRetry}
        </button>
      )}
    </div>
  );
}

export function ThumbImage(props: {
  token: string | null;
  thumbRelativePath: string;
  needsWorkingCopySync: boolean;
  alt: string;
  /** 缺省 thumb。封面用 cover，代理不要交给 img。画布不传 original。 */
  purpose?: "thumb" | "cover" | "proxy";
}): ReactElement {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [retryKey, setRetryKey] = useState(0);
  const pathRef = useRef(props.thumbRelativePath);
  pathRef.current = props.thumbRelativePath;

  useEffect(() => {
    if (props.needsWorkingCopySync || props.token === null) {
      setSrc(null);
      setFailed(false);
      return;
    }
    let cancelled = false;
    let release: (() => void) | null = null;
    const run = async (): Promise<void> => {
      setFailed(false);
      setSrc(null);
      const ticket = await requestMediaTicket(props.token as string, {
        relativePath: pathRef.current,
        purpose: props.purpose ?? "thumb",
      });
      if (cancelled) {
        return;
      }
      if (!ticket.ok) {
        setFailed(true);
        return;
      }
      release = await acquireDecodeSlot();
      if (cancelled) {
        release();
        return;
      }
      setSrc(resolveThumbSrc({ ticketId: ticket.data.ticketId, failed: false }).src);
    };
    void run();
    return () => {
      cancelled = true;
      release?.();
    };
  }, [props.needsWorkingCopySync, props.purpose, props.token, props.thumbRelativePath, retryKey]);

  const ticketId =
    src !== null && src.startsWith("/api/media-ticket/") ? src.slice("/api/media-ticket/".length) : null;
  const shown = resolveThumbSrc({ ticketId, failed });
  if (props.needsWorkingCopySync || shown.state === "pending") {
    return <div className="thumb-block" data-result-state="pending" aria-hidden="true" />;
  }

  if (shown.state !== "thumb-ready" || shown.src === null) {
    return (
      <div data-result-state="thumb-failed">
        <ThumbFailed onRetry={() => {
          setFailed(false);
          setRetryKey((key) => key + 1);
        }} />
      </div>
    );
  }

  return (
    <img
      className="thumb-image"
      data-result-state="thumb-ready"
      alt={props.alt}
      src={shown.src}
      draggable={false}
      onError={() => {
        setFailed(true);
        setSrc(null);
      }}
    />
  );
}
