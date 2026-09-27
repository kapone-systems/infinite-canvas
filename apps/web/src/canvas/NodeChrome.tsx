import type { CSSProperties, ReactElement, ReactNode } from "react";
import type { ProjectNode } from "@canvas/schema";
import { USER_FACING, generationBadge, userBadgeLabel } from "@canvas/schema";
import { progressModeAttr, taskStatusAttr } from "../execution/taskStatus.ts";
import { COPY } from "../ui/copy.ts";
import { nodeTransform } from "./coords.ts";
import { HEADER } from "./metrics.ts";
import { versionLabel } from "./versionLabel.ts";

export function partialSuccessCaption(node: ProjectNode): string | null {
  const version = (node.versions ?? []).find((item) => item.id === node.currentVersionId);
  if (version === undefined) {
    return null;
  }
  const succeeded = version.variants.filter((item) => item.phase === "succeeded").length;
  if (succeeded === 0 || succeeded >= version.variantCountRequested) {
    return null;
  }
  const badge = generationBadge(node);
  if (badge !== "succeeded" && badge !== "stale") {
    return null;
  }
  return USER_FACING.partialSuccess(version.variantCountRequested, succeeded);
}

export function NodeChrome(props: {
  node: ProjectNode;
  selected: boolean;
  cancelling?: boolean;
  children: ReactNode;
}): ReactElement {
  const style: CSSProperties = {
    transform: nodeTransform(props.node.x, props.node.y),
    width: props.node.width,
    height: props.node.height,
    zIndex: props.node.z,
  };
  const badge = props.node.kind === "generation" ? generationBadge(props.node) : null;
  const caption = props.node.kind === "generation" ? partialSuccessCaption(props.node) : null;
  const versions = props.node.kind === "generation" ? versionLabel(props.node) : null;
  const cancelling = props.cancelling === true;
  return (
    <article
      className={props.selected ? "node-chrome is-selected" : "node-chrome"}
      data-node-id={props.node.id}
      data-node-kind={props.node.kind}
      data-freshness={props.node.freshness ?? "fresh"}
      data-task-status={taskStatusAttr(props.node, cancelling)}
      data-progress-mode={progressModeAttr(props.node)}
      style={style}
    >
      <header className="node-header node-drag-handle" style={{ height: HEADER }}>
        <span className="node-title">{props.node.title}</span>
        {badge !== null ? (
          <span className="generation-badge-wrap">
            <span
              className="generation-badge"
              data-badge={badge}
              title={badge === "stale" ? COPY.staleHover : userBadgeLabel(badge)}
              aria-label={userBadgeLabel(badge)}
            >
              {userBadgeLabel(badge)}
            </span>
            {caption !== null ? (
              <span className="generation-badge-sub" data-partial-success="">
                {caption}
              </span>
            ) : null}
          </span>
        ) : null}
        {versions !== null ? (
          <span className="version-label" data-version-label="">
            {versions}
          </span>
        ) : null}
      </header>
      <div className="node-body">{props.children}</div>
    </article>
  );
}
