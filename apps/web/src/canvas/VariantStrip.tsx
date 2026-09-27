import type { ReactElement } from "react";
import type { ProjectNode, Variant } from "@canvas/schema";
import { COPY } from "../ui/copy.ts";
import { currentVersionVariants } from "./document.ts";
import { GENERATION_VARIANT_STRIP } from "./metrics.ts";
import { ThumbImage } from "./ThumbImage.tsx";

export function VariantStrip(props: {
  node: ProjectNode;
  variants?: readonly Variant[];
  token?: string | null;
  needsWorkingCopySync?: boolean;
  onClickVariant?: (variantId: string) => void;
}): ReactElement | null {
  const variants = props.variants ?? currentVersionVariants(props.node);
  if (variants.length === 0) {
    return null;
  }
  return (
    <div
      className="variant-strip"
      data-variant-strip={props.node.id}
      style={{ height: GENERATION_VARIANT_STRIP }}
    >
      {variants.map((variant) => (
        <button
          type="button"
          key={variant.id}
          className={
            props.node.activeVariantId === variant.id ? "variant-cell is-active" : "variant-cell"
          }
          data-variant-id={variant.id}
          data-variant-phase={variant.phase}
          onClick={() => {
            props.onClickVariant?.(variant.id);
          }}
        >
          {variant.output?.thumbRelativePath != null && variant.output.thumbRelativePath !== "" ? (
            <ThumbImage
              token={props.token ?? null}
              thumbRelativePath={variant.output.thumbRelativePath}
              needsWorkingCopySync={props.needsWorkingCopySync === true}
              alt=""
            />
          ) : (
            <span>
              {variant.phase === "failed"
                ? COPY.badgeFailed
                : variant.phase === "queued"
                  ? COPY.badgeQueued
                  : variant.phase === "running"
                    ? COPY.badgeRunning
                    : ""}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}
