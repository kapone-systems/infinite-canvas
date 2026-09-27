import type { ReactElement } from "react";
import type { ProjectNode } from "@canvas/schema";
import { COPY } from "../ui/copy.ts";
import { mediaMissingPath } from "./mediaPresence.ts";
import { ThumbImage } from "./ThumbImage.tsx";

export function MediaMissingView(props: { path: string }): ReactElement {
  return (
    <div className="media-missing" data-result-state="media-missing">
      <p className="media-missing-primary">{COPY.mediaMissing}</p>
      <p className="media-missing-secondary">{props.path}</p>
    </div>
  );
}

/** 近景图片只走缩略图票据，禁止原件 / blob。缺失时不拿 relativePath 当 img。 */
export function ImageNodeView(props: {
  node: ProjectNode;
  token: string | null;
  needsWorkingCopySync: boolean;
  missingPaths?: readonly string[];
  onOpenViewer?: (thumbRelativePath: string) => void;
}): ReactElement {
  const missing = mediaMissingPath(props.node, new Set(props.missingPaths ?? []));
  if (missing !== null) {
    return <MediaMissingView path={missing} />;
  }
  const thumb = props.node.output?.thumbRelativePath;
  if (thumb == null || thumb === "") {
    return <div className="thumb-block" aria-hidden="true" />;
  }
  return (
    <div className="image-node-preview">
      <ThumbImage
        token={props.token}
        thumbRelativePath={thumb}
        needsWorkingCopySync={props.needsWorkingCopySync}
        alt={props.node.title}
      />
      {props.onOpenViewer !== undefined ? (
        <button
          type="button"
          className="btn btn-secondary"
          data-open-viewer=""
          onClick={() => {
            props.onOpenViewer?.(thumb);
          }}
        >
          {COPY.viewLargeImage}
        </button>
      ) : null}
    </div>
  );
}
