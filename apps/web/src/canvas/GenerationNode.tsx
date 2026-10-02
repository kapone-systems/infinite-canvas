import { useEffect, useRef, useState, type ReactElement } from "react";
import type { ProjectEdge, ProjectNode, Slot, SlotRole } from "@canvas/schema";
import {
  addableRoles,
  capabilityByProfileId,
  resolveSlotMedia,
  roleDisplayIndex,
  roleLabel,
  slotTitle,
} from "@canvas/schema";
import { COPY } from "../ui/copy.ts";
import { currentVersionVariants, generationPreviewMain, generationPreviewText, hasPromptEdge } from "./document.ts";
import { MediaMissingView } from "./ImageNode.tsx";
import { mediaMissingPath } from "./mediaPresence.ts";
import { createImeTracker, shouldCommitTextCommand } from "./ime.ts";
import { SLOT_ROLE_STROKE, SLOT_ROW, outputAnchorLocal } from "./metrics.ts";
import { applyFocusedTextHistoryKey } from "./shortcuts.ts";
import { ThumbFailed, ThumbImage } from "./ThumbImage.tsx";
import { VariantStrip } from "./VariantStrip.tsx";
import { VideoPoster } from "./VideoNode.tsx";
import { videoPreviewPending } from "@canvas/schema";

export function GenerationNodeView(props: {
  node: ProjectNode;
  nodes?: Record<string, ProjectNode>;
  edges?: Record<string, ProjectEdge>;
  token?: string | null;
  needsWorkingCopySync?: boolean;
  onAddSlot?: (role: SlotRole) => void;
  onPromptDraft?: (text: string) => void;
  onComposingChange?: (composing: boolean) => void;
  onUndo?: () => void;
  onRedo?: () => void;
  overlayLabel?: string | null;
  onClickVariant?: (variantId: string) => void;
  missingPaths?: readonly string[];
  onOpenViewer?: (thumbRelativePath: string) => void;
  onOpenProxy?: (proxyRelativePath: string) => void;
}): ReactElement {
  const slots = [...(props.node.slots ?? [])].sort((a, b) => a.order - b.order);
  const output = outputAnchorLocal(props.node.width);
  const descriptor = props.node.profileId != null ? capabilityByProfileId(props.node.profileId) : null;
  const addable = descriptor !== null ? addableRoles(descriptor, slots) : [];
  const nodes = props.nodes ?? {};
  const edges = props.edges ?? {};
  const promptBound = hasPromptEdge(props.node);
  const previewError = generationPreviewText(props.node);
  const previewMain = generationPreviewMain(props.node);
  const variants = currentVersionVariants(props.node);
  const [menuOpen, setMenuOpen] = useState(false);
  const imeRef = useRef(createImeTracker());
  const draftRef = useRef<HTMLTextAreaElement>(null);
  const thumb = props.node.output?.thumbRelativePath;
  const videoNode = props.node.outputKind === "video" || props.node.output?.kind === "video";
  const pendingVideo = videoPreviewPending(props.node);
  const missing = mediaMissingPath(props.node, new Set(props.missingPaths ?? []));
  const draft = props.node.promptDraft ?? "";

  useEffect(() => {
    const el = draftRef.current;
    if (el !== null && !imeRef.current.isComposing() && el.value !== draft) {
      el.value = draft;
    }
  }, [draft]);

  return (
    <div className="generation-node">
      <div className="node-slots">
        {slots.map((slot) => (
          <SlotRow
            key={slot.id}
            slot={slot}
            slots={slots}
            nodes={nodes}
            edges={edges}
            required={descriptor?.slots.find((spec) => spec.role === slot.role)?.required === true}
          />
        ))}
      </div>
      <div className="generation-add-slot">
        {addable.length > 0 ? (
          <div className="add-slot-menu" data-add-slot="">
            <button
              type="button"
              className="btn btn-secondary generation-add-slot-btn"
              data-add-slot=""
              aria-expanded={menuOpen}
              onClick={() => {
                setMenuOpen((open) => !open);
              }}
            >
              {COPY.addSlot}
            </button>
            {menuOpen ? (
              <div className="add-slot-list" data-add-slot="">
                {addable.map((role) => (
                  <button
                    key={role}
                    type="button"
                    className="btn btn-secondary generation-add-slot-btn"
                    data-add-slot=""
                    data-slot-role={role}
                    onClick={() => {
                      props.onAddSlot?.(role);
                      setMenuOpen(false);
                    }}
                  >
                    {roleLabel(role)}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
      <div className="node-preview generation-preview">
        {props.overlayLabel != null && props.overlayLabel !== "" ? (
          <p className="generation-empty" data-progress-label="">
            {props.overlayLabel}
          </p>
        ) : previewError !== null ? (
          <p className="generation-empty">{previewError}</p>
        ) : missing !== null ? (
          <MediaMissingView path={missing} />
        ) : videoNode && (pendingVideo || props.node.output?.kind === "video") ? (
          <VideoPoster
            media={props.node.output ?? null}
            pending={pendingVideo || previewMain === COPY.previewPending}
            token={props.token ?? null}
            needsWorkingCopySync={props.needsWorkingCopySync === true}
            alt={props.node.title}
            onOpenProxy={props.onOpenProxy}
          />
        ) : thumb != null && thumb !== "" ? (
          <>
            <ThumbImage
              token={props.token ?? null}
              thumbRelativePath={thumb}
              needsWorkingCopySync={props.needsWorkingCopySync === true}
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
          </>
        ) : props.node.output != null ? (
          <ThumbFailed />
        ) : (
          <p className="generation-empty">{COPY.emptyGenerationPreview}</p>
        )}
      </div>
      {promptBound ? (
        <p className="prompt-from-edge">{COPY.promptFromEdge}</p>
      ) : (
        <textarea
          ref={draftRef}
          className="generation-prompt-draft"
          defaultValue={draft}
          aria-label={roleLabel("prompt")}
          onCompositionStart={() => {
            imeRef.current.start();
            props.onComposingChange?.(true);
          }}
          onCompositionEnd={(event) => {
            imeRef.current.end();
            props.onComposingChange?.(false);
            props.onPromptDraft?.(event.currentTarget.value);
          }}
          onInput={(event) => {
            if (shouldCommitTextCommand(imeRef.current.isComposing())) {
              props.onPromptDraft?.(event.currentTarget.value);
            }
          }}
          onKeyDown={(event) => {
            applyFocusedTextHistoryKey(event, {
              composing: imeRef.current.isComposing(),
              undo: props.onUndo ?? (() => undefined),
              redo: props.onRedo ?? (() => undefined),
            });
          }}
        />
      )}
      <VariantStrip
        node={props.node}
        variants={variants}
        token={props.token ?? null}
        needsWorkingCopySync={props.needsWorkingCopySync === true}
        onClickVariant={props.onClickVariant}
      />
      <span
        className="node-output-port"
        data-output-port={props.node.id}
        style={{ top: output.y, left: output.x }}
        aria-hidden="true"
      />
    </div>
  );
}

function SlotRow(props: {
  slot: Slot;
  slots: readonly Slot[];
  nodes: Record<string, ProjectNode>;
  edges: Record<string, ProjectEdge>;
  required: boolean;
}): ReactElement {
  const title = slotTitle(props.slots, props.slot);
  const index = roleDisplayIndex(props.slots, props.slot);
  const connected = props.slot.edgeId !== null;
  const edge = props.slot.edgeId !== null ? props.edges[props.slot.edgeId] : undefined;
  const sourceTitle = edge !== undefined ? props.nodes[edge.sourceNodeId]?.title ?? "" : "";
  const media = resolveSlotMedia(props.slot, props.nodes, props.edges);
  let hint = "";
  if (!connected) {
    hint = props.required ? COPY.slotRequired : COPY.slotOptional;
  } else if (props.slot.role !== "prompt" && media == null) {
    hint = COPY.slotConnectedNoOutput;
  } else if (props.slot.role === "prompt") {
    hint = COPY.promptFromEdge;
  }
  return (
    <div
      className="node-slot"
      data-slot-id={props.slot.id}
      data-slot-role={props.slot.role}
      data-slot-index={String(index)}
      tabIndex={0}
      style={{ height: SLOT_ROW }}
    >
      <span
        className="node-slot-port"
        data-slot-role={props.slot.role}
        style={{ background: SLOT_ROLE_STROKE[props.slot.role] }}
        aria-hidden="true"
      />
      <span
        className="node-slot-handle"
        data-slot-handle={props.slot.id}
        data-slot-id={props.slot.id}
        aria-hidden="true"
      />
      <span className="node-slot-label">{title}</span>
      {connected && edge !== undefined ? (
        <span className="node-slot-chip" data-slot-chip={props.slot.id} title={sourceTitle}>
          {sourceTitle}
        </span>
      ) : null}
      {hint !== "" ? <span className="node-slot-hint">{hint}</span> : null}
    </div>
  );
}
