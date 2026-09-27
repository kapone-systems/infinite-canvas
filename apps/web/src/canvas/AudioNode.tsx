import { useEffect, useRef, useState, type ReactElement } from "react";
import type { ProjectNode } from "@canvas/schema";
import { requestMediaTicket } from "../api/client.ts";
import { COPY } from "../ui/copy.ts";
import {
  audioRelativePath,
  audioTicketSrc,
  shouldMountAudioElement,
  shouldRequestAudioTicket,
} from "./audioPreview.ts";
import { formatDuration } from "./formatDuration.ts";

/**
 * 近景外壳里的音频。远景不挂这个组件，只画色块。
 * 选中后用 purpose=audio 的票据播放，不自动出声。未选中不挂 audio。
 */
export function AudioNodeView(props: {
  node: ProjectNode;
  token: string | null;
  selected: boolean;
  needsWorkingCopySync: boolean;
}): ReactElement {
  const relativePath = audioRelativePath(props.node.output);
  const [src, setSrc] = useState<string | null>(null);
  const request = shouldRequestAudioTicket({
    selected: props.selected,
    needsWorkingCopySync: props.needsWorkingCopySync,
    token: props.token,
    relativePath,
  });

  useEffect(() => {
    if (!request || props.token === null || relativePath === null) {
      setSrc(null);
      return;
    }
    let cancelled = false;
    const token = props.token;
    const path = relativePath;
    const run = async (): Promise<void> => {
      setSrc(null);
      const ticket = await requestMediaTicket(token, {
        relativePath: path,
        purpose: "audio",
      });
      if (cancelled || !ticket.ok) {
        return;
      }
      setSrc(audioTicketSrc(ticket.data.ticketId));
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [props.token, relativePath, request]);

  const mount = shouldMountAudioElement({
    selected: props.selected,
    needsWorkingCopySync: props.needsWorkingCopySync,
    src,
  });
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    if (!mount) {
      setPlaying(false);
    }
  }, [mount]);

  return (
    <div className="media-node media-node-audio">
      {relativePath === null ? (
        <p className="media-empty">{COPY.emptyAudio}</p>
      ) : (
        <p className="media-duration">{formatDuration(props.node.output?.durationMs ?? null)}</p>
      )}
      {mount && src !== null ? (
        <>
          <audio
            ref={audioRef}
            src={src}
            preload="none"
            data-playback="audio"
            onPlay={() => {
              setPlaying(true);
            }}
            onPause={() => {
              setPlaying(false);
            }}
            onEnded={() => {
              setPlaying(false);
            }}
          />
          <button
            type="button"
            className="btn btn-secondary"
            data-audio-toggle=""
            onClick={() => {
              const element = audioRef.current;
              if (element === null) {
                return;
              }
              if (element.paused) {
                void element.play();
                return;
              }
              element.pause();
            }}
          >
            {playing ? COPY.pauseAudio : COPY.playProxy}
          </button>
        </>
      ) : null}
    </div>
  );
}
