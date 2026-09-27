import { useEffect, useRef, useState, type ReactElement } from "react";
import { requestMediaTicket } from "../api/client.ts";
import { COPY } from "../ui/copy.ts";
import { claimPlayback, releasePlayback } from "./playback.ts";
import { resolveThumbSrc } from "./thumbSrc.ts";
import { consumeViewerWheel } from "./viewerWheel.ts";

/**
 * 覆盖层只播代理票据。同一时间 claimPlayback 只留一个。
 * 地址只用票据，不用原片 relativePath。
 */
export function VideoViewer(props: {
  token: string;
  proxyRelativePath: string;
  onClose: () => void;
}): ReactElement {
  const ref = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (el === null) {
      return;
    }
    const onWheel = (event: WheelEvent): void => {
      consumeViewerWheel(event);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      el.removeEventListener("wheel", onWheel);
    };
  }, []);
  useEffect(() => {
    let cancelled = false;
    const run = async (): Promise<void> => {
      setSrc(null);
      const ticket = await requestMediaTicket(props.token, {
        relativePath: props.proxyRelativePath,
        purpose: "proxy",
      });
      if (cancelled) {
        return;
      }
      if (!ticket.ok) {
        setSrc(null);
        return;
      }
      setSrc(resolveThumbSrc({ ticketId: ticket.data.ticketId, failed: false }).src);
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [props.proxyRelativePath, props.token]);
  useEffect(() => {
    const video = videoRef.current;
    if (video === null || src === null) {
      return;
    }
    claimPlayback(props.proxyRelativePath, () => {
      video.pause();
    });
    return () => {
      video.pause();
      releasePlayback(props.proxyRelativePath);
    };
  }, [props.proxyRelativePath, src]);
  return (
    <div ref={ref} className="image-viewer" data-video-viewer="true" role="dialog">
      {src !== null ? (
        <video ref={videoRef} src={src} controls data-playback="proxy" />
      ) : (
        <p>{COPY.previewPending}</p>
      )}
      <button type="button" className="btn btn-secondary" onClick={props.onClose}>
        {COPY.closeViewer}
      </button>
    </div>
  );
}
