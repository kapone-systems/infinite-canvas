import type { ReactElement } from "react";
import type { MediaRef, ProjectNode } from "@canvas/schema";
import { videoPreviewPending } from "@canvas/schema";
import { COPY } from "../ui/copy.ts";
import { formatDuration } from "./formatDuration.ts";
import { ThumbImage } from "./ThumbImage.tsx";

/** 画布不播原片。近景只走封面票据；首尾帧芯片走 thumb。帧文件还没有时芯片禁用。 */
export function VideoNodeView(props: {
  node: ProjectNode;
  token: string | null;
  needsWorkingCopySync: boolean;
  onOpenProxy?: (proxyRelativePath: string) => void;
}): ReactElement {
  return (
    <VideoPoster
      media={props.node.output ?? null}
      pending={videoPreviewPending(props.node) || (props.node.output?.kind === "video" && !posterReady(props.node.output))}
      token={props.token}
      needsWorkingCopySync={props.needsWorkingCopySync}
      alt={props.node.title}
      onOpenProxy={props.onOpenProxy}
    />
  );
}

export function VideoPoster(props: {
  media: MediaRef | null;
  pending: boolean;
  token: string | null;
  needsWorkingCopySync: boolean;
  alt: string;
  onOpenProxy?: (proxyRelativePath: string) => void;
}): ReactElement {
  const media = props.media;
  const cover = media?.coverRelativePath ?? null;
  const proxy = media?.proxyRelativePath ?? null;
  return (
    <div className="media-node media-node-video" data-playback="poster">
      {props.pending ? (
        <p className="generation-empty" data-result-state="preview-pending">
          {COPY.previewPending}
        </p>
      ) : cover != null && cover !== "" ? (
        <ThumbImage
          token={props.token}
          thumbRelativePath={cover}
          needsWorkingCopySync={props.needsWorkingCopySync}
          alt={props.alt}
          purpose="cover"
        />
      ) : (
        <div className="thumb-block" aria-hidden="true" />
      )}
      <p className="media-duration">{formatDuration(media?.durationMs ?? null)}</p>
      <FrameChip
        label="首帧图"
        token={props.token}
        relativePath={media?.firstFrameRelativePath ?? null}
        needsWorkingCopySync={props.needsWorkingCopySync}
      />
      <FrameChip
        label="尾帧图"
        token={props.token}
        relativePath={media?.lastFrameRelativePath ?? null}
        needsWorkingCopySync={props.needsWorkingCopySync}
      />
      {proxy != null && proxy !== "" && props.onOpenProxy !== undefined ? (
        <button
          type="button"
          className="btn btn-secondary"
          data-open-proxy=""
          onClick={() => {
            props.onOpenProxy?.(proxy);
          }}
        >
          {COPY.playProxy}
        </button>
      ) : null}
    </div>
  );
}

export function FrameChip(props: {
  label: string;
  token: string | null;
  relativePath: string | null;
  needsWorkingCopySync: boolean;
}): ReactElement {
  const ready = props.relativePath != null && props.relativePath !== "";
  return (
    <button type="button" className="frame-chip" data-frame-chip={props.label} disabled={!ready}>
      <span>{props.label}</span>
      {ready ? (
        <ThumbImage
          token={props.token}
          thumbRelativePath={props.relativePath as string}
          needsWorkingCopySync={props.needsWorkingCopySync}
          alt={props.label}
          purpose="thumb"
        />
      ) : null}
    </button>
  );
}

function posterReady(media: MediaRef): boolean {
  return media.coverRelativePath != null && media.coverRelativePath !== "" && media.proxyRelativePath != null && media.proxyRelativePath !== "";
}

export { formatDuration };
