import type { ReactElement } from "react";
import type {
  CapabilityParamSpec,
  ProjectEdge,
  ProjectGroup,
  ProjectNode,
  RunPlan,
  RunRequest,
  Slot,
} from "@canvas/schema";
import {
  MEDIA_KIND_LABELS,
  RANDOM_SEED,
  capabilityByProfileId,
  listRecipes,
  slotTitle,
  videoPreviewPending,
} from "@canvas/schema";
import { expandSelectionToNodes } from "../canvas/document.ts";
import { FrameChip, formatDuration } from "../canvas/VideoNode.tsx";
import { versionLabel } from "../canvas/versionLabel.ts";
import { isThisNodeBusy } from "../execution/runFlow.ts";
import { provenanceSourceLine, slotSourceLine } from "./sourceLine.ts";
import { inspectorSecretFollowUp } from "./secretFollowUp.ts";
import { foldRunningDetails, inspectorErrorLines, runningDetailsFromNodes } from "./taskBar.ts";
import { COPY } from "./copy.ts";

export function planRowClass(row: RunPlan["nodes"][number]): string {
  if (row.action === "run") {
    return "";
  }
  if (row.skipReason === "fresh" || row.skipReason === "text_node" || row.skipReason === "cancelled") {
    return "plan-skip";
  }
  return "plan-error";
}

export function Inspector(props: {
  nodes: readonly ProjectNode[];
  edges: Record<string, ProjectEdge>;
  groups: Record<string, ProjectGroup>;
  selectedIds: readonly string[];
  lastEmittedRunRequest: RunRequest | null;
  lastPlan: RunPlan | null;
  offline: boolean;
  workingCopyBlocked: boolean;
  optimisticThis: { nodeId: string; cancelling: boolean } | null;
  canRetryFailed: boolean;
  runRejectMessage: string | null;
  onRunThis: (nodeId: string) => void;
  onCancelThis: (nodeId: string) => void;
  onRunDownstream: (nodeId: string) => void;
  onRunSelection: () => void;
  onRetryFailed: () => void;
  onParamsChange: (nodeId: string, params: Record<string, string | number | boolean | null>) => void;
  onVariantCountChange: (nodeId: string, count: number) => void;
  onSelectVersion?: (nodeId: string, versionId: string) => void;
  onRecipeChange?: (nodeId: string, recipeId: string) => void;
  onRegeneratePreview?: (nodeId: string) => void;
  token?: string | null;
}): ReactElement {
  const nodeRecord: Record<string, ProjectNode> = {};
  for (const node of props.nodes) {
    nodeRecord[node.id] = node;
  }
  const expandedIds = expandSelectionToNodes(nodeRecord, props.groups, props.selectedIds);
  const selected = expandedIds
    .map((id) => nodeRecord[id])
    .filter((node): node is ProjectNode => node !== undefined);
  const generations = selected.filter((node) => node.kind === "generation");
  const gate = runGateReason(props.offline, props.workingCopyBlocked);
  const single = selected.length === 1 ? selected[0] : undefined;
  const singleGeneration = single?.kind === "generation" ? single : undefined;
  const secretFollowUp = inspectorSecretFollowUp(props.runRejectMessage);

  return (
    <aside className="inspector" data-inspector="true" aria-label="检查器">
      <h2 className="inspector-title">检查器</h2>
      {selected.length === 0 ? (
        <p className="field-reason">{COPY.selectedCount(0)}</p>
      ) : (
        <p className="inspector-count">{COPY.selectedCount(selected.length)}</p>
      )}
      {single !== undefined ? <p className="inspector-kind">{kindLabel(single)}</p> : null}
      {single !== undefined && single.kind !== "generation" ? (
        <ProvenanceLine node={single} nodes={nodeRecord} />
      ) : null}
      {single !== undefined && single.kind === "video" ? (
        <div data-video-inspector="">
          <FrameChip
            label="首帧图"
            token={props.token ?? null}
            relativePath={single.output?.firstFrameRelativePath ?? null}
            needsWorkingCopySync={false}
          />
          <FrameChip
            label="尾帧图"
            token={props.token ?? null}
            relativePath={single.output?.lastFrameRelativePath ?? null}
            needsWorkingCopySync={false}
          />
          <p className="field-reason" data-last-frame-note="">
            {COPY.lastFrameApproximate}
          </p>
        </div>
      ) : null}
      {singleGeneration !== undefined ? (
        <GenerationInspector
          node={singleGeneration}
          nodes={nodeRecord}
          edges={props.edges}
          onParamsChange={props.onParamsChange}
          onVariantCountChange={props.onVariantCountChange}
          onSelectVersion={props.onSelectVersion}
          onRecipeChange={props.onRecipeChange}
          onRegeneratePreview={props.onRegeneratePreview}
          token={props.token ?? null}
          offline={props.offline}
        />
      ) : null}
      {generations.length > 1 ? (
        <ul className="inspector-multi-list">
          {generations.map((node) => (
            <li key={node.id}>{node.title}</li>
          ))}
        </ul>
      ) : null}
      <div className="inspector-run">
        {single?.kind === "generation" ? (
          <ThisRunButton
            node={single}
            gate={gate}
            offline={props.offline}
            optimisticThis={props.optimisticThis}
            onRunThis={props.onRunThis}
            onCancelThis={props.onCancelThis}
          />
        ) : null}
        <RunButton
          label={COPY.runDownstream}
          dataRun="downstream"
          disabled={gate !== null || single === undefined}
          reason={gate}
          onClick={() => {
            if (single !== undefined) {
              props.onRunDownstream(single.id);
            }
          }}
        />
        <RunButton
          label={COPY.runSelection}
          dataRun="selection"
          disabled={gate !== null || generations.length === 0}
          reason={gate}
          onClick={() => {
            props.onRunSelection();
          }}
        />
      </div>
      {props.runRejectMessage === COPY.secretMissing ? (
        <div data-secret-reject="">
          <p className="plan-error">{props.runRejectMessage}</p>
          {secretFollowUp !== null ? (
            <p className="field-reason" data-secret-refill="">
              {secretFollowUp}
            </p>
          ) : null}
        </div>
      ) : null}
      {props.lastPlan !== null ? (
        <div className="inspector-plan" data-last-plan="true">
          {props.lastPlan.nodes.map((row) => (
            <p
              key={row.nodeId}
              className={planRowClass(row)}
              data-plan-node={row.nodeId}
              data-plan-action={row.action}
            >
              {row.message}
            </p>
          ))}
        </div>
      ) : null}
      <TaskBars nodes={props.nodes} />
      {props.canRetryFailed ? (
        <div className="btn-with-reason">
          <button
            type="button"
            className="btn btn-secondary"
            data-retry-failed="true"
            disabled={gate !== null}
            onClick={() => {
              props.onRetryFailed();
            }}
          >
            {COPY.retryFailed}
          </button>
        </div>
      ) : null}
      {props.lastEmittedRunRequest !== null ? (
        <pre className="inspector-run-request" data-last-emitted-run="true">
          {JSON.stringify(
            {
              scope: props.lastEmittedRunRequest.scope,
              force: props.lastEmittedRunRequest.force,
            },
            null,
            2,
          )}
        </pre>
      ) : null}
    </aside>
  );
}

function TaskBars(props: { nodes: readonly ProjectNode[] }): ReactElement | null {
  const folded = foldRunningDetails(runningDetailsFromNodes(props.nodes));
  const total = folded.local.shown.length + folded.local.hidden + folded.cloud.shown.length + folded.cloud.hidden;
  if (total === 0) {
    return null;
  }
  return (
    <div className="inspector-plan" data-task-bar="">
      <LaneRows lane="local" title="本地" rows={folded.local} />
      <LaneRows lane="cloud" title="云端" rows={folded.cloud} />
    </div>
  );
}

function LaneRows(props: {
  lane: "local" | "cloud";
  title: string;
  rows: { shown: Array<{ id: string; label: string }>; hidden: number };
}): ReactElement {
  return (
    <div data-task-lane={props.lane}>
      <p className="inspector-kind">{props.title}</p>
      {props.rows.shown.length === 0 ? (
        <p className="field-reason">{COPY.queueEmpty}</p>
      ) : (
        props.rows.shown.map((row) => (
          <p key={row.id} className="field-reason" data-task-row={row.id}>
            {row.label}
          </p>
        ))
      )}
      {props.rows.hidden > 0 ? (
        <p className="field-reason" data-task-more={props.lane}>
          {COPY.moreRunning(props.rows.hidden)}
        </p>
      ) : null}
    </div>
  );
}

function ThisRunButton(props: {
  node: ProjectNode;
  gate: string | null;
  offline: boolean;
  optimisticThis: { nodeId: string; cancelling: boolean } | null;
  onRunThis: (nodeId: string) => void;
  onCancelThis: (nodeId: string) => void;
}): ReactElement {
  const busy = isThisNodeBusy({
    nodeId: props.node.id,
    phase: props.node.phase,
    optimisticThis: props.optimisticThis,
  });
  if (busy) {
    return (
      <RunButton
        label={COPY.cancel}
        dataRun="this"
        disabled={props.offline}
        reason={props.offline ? COPY.runDisabledOffline : null}
        onClick={() => {
          props.onCancelThis(props.node.id);
        }}
      />
    );
  }
  return (
    <RunButton
      label={COPY.runThisNode}
      dataRun="this"
      disabled={props.gate !== null}
      reason={props.gate}
      onClick={() => {
        props.onRunThis(props.node.id);
      }}
    />
  );
}

function ProvenanceLine(props: {
  node: ProjectNode;
  nodes: Record<string, ProjectNode>;
}): ReactElement | null {
  const title = provenanceSourceLine(props.node, props.nodes);
  if (title === null) {
    return null;
  }
  return (
    <p className="field-reason" data-source-line="">
      {`来源 ${title}`}
    </p>
  );
}

function GenerationInspector(props: {
  node: ProjectNode;
  nodes: Record<string, ProjectNode>;
  edges: Record<string, ProjectEdge>;
  onParamsChange: (nodeId: string, params: Record<string, string | number | boolean | null>) => void;
  onVariantCountChange: (nodeId: string, count: number) => void;
  onSelectVersion?: (nodeId: string, versionId: string) => void;
  onRecipeChange?: (nodeId: string, recipeId: string) => void;
  onRegeneratePreview?: (nodeId: string) => void;
  token: string | null;
  offline: boolean;
}): ReactElement {
  const slots = [...(props.node.slots ?? [])].sort((a, b) => a.order - b.order);
  const descriptor = props.node.profileId != null ? capabilityByProfileId(props.node.profileId) : null;
  const specs = descriptor?.params.filter((item) => item.userFacing) ?? [];
  const params = props.node.params ?? {};
  const variantCount = props.node.variantCount ?? 1;
  const versions = props.node.versions ?? [];
  const currentLabel = versionLabel(props.node);
  const recipes = listRecipes().filter(
    (item) => item.profileId === props.node.profileId && item.enabled && item.implemented,
  );
  const currentRecipe = recipes.find((item) => item.id === props.node.recipeId) ?? null;
  const showVideo = props.node.outputKind === "video" || props.node.output?.kind === "video";
  const showRegen = showVideo && (videoPreviewPending(props.node) || props.node.lastError?.code === "PROXY_MEDIA_FAILED");
  const errorLines = inspectorErrorLines(props.node.lastError);
  const errorSecond = readErrorSecond(errorLines);
  return (
    <>
      {errorLines !== null ? (
        <div data-node-error="">
          <p className="plan-error">{errorLines.message}</p>
          {errorSecond !== null ? (
            <p className="field-reason" data-error-detail="">
              {errorSecond}
            </p>
          ) : null}
        </div>
      ) : null}
      {currentRecipe !== null ? (
        <div data-recipe-id={currentRecipe.id} data-recipe-title={currentRecipe.title}>
          <p className="field-reason">{currentRecipe.id}</p>
          <p className="field-reason">{currentRecipe.title}</p>
        </div>
      ) : null}
      {recipes.length > 1 ? (
        <label className="field">
          <span>配方</span>
          <select
            data-recipe-select=""
            value={props.node.recipeId ?? ""}
            onChange={(event) => {
              props.onRecipeChange?.(props.node.id, event.target.value);
            }}
          >
            {recipes.map((recipe) => (
              <option key={recipe.id} value={recipe.id}>
                {recipe.title}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {currentLabel !== null ? (
        <p className="field-reason" data-version-label="">
          {currentLabel}
        </p>
      ) : null}
      {versions.length > 1 ? (
        <div className="btn-row" data-version-list="">
          {versions.map((version) => (
            <button
              key={version.id}
              type="button"
              className="btn btn-secondary"
              data-version-id={version.id}
              disabled={version.id === props.node.currentVersionId}
              onClick={() => {
                props.onSelectVersion?.(props.node.id, version.id);
              }}
            >
              {`版本 ${versions.findIndex((item) => item.id === version.id) + 1} / 共 ${versions.length}`}
            </button>
          ))}
        </div>
      ) : null}
      <ul className="inspector-slots">
        {slots.map((slot) => (
          <InspectorSlot
            key={slot.id}
            slot={slot}
            slots={slots}
            nodes={props.nodes}
            edges={props.edges}
            required={descriptor?.slots.find((spec) => spec.role === slot.role)?.required === true}
          />
        ))}
      </ul>
      {specs.length > 0 ? (
        <div className="inspector-params">
          {specs.map((spec) => (
            <ParamField
              key={spec.key}
              spec={spec}
              value={params[spec.key] ?? spec.default ?? null}
              onChange={(next) => {
                props.onParamsChange(props.node.id, { ...params, [spec.key]: next });
              }}
            />
          ))}
        </div>
      ) : null}
      <label className="field">
        <span>{COPY.variantCountLabel}</span>
        <input
          type="number"
          min={1}
          max={4}
          data-variant-count=""
          value={variantCount}
          onChange={(event) => {
            const parsed = Number.parseInt(event.target.value, 10);
            if (Number.isInteger(parsed)) {
              props.onVariantCountChange(props.node.id, parsed);
            }
          }}
        />
      </label>
      {showVideo ? (
        <div data-video-inspector="">
          <FrameChip
            label="首帧图"
            token={props.token}
            relativePath={props.node.output?.firstFrameRelativePath ?? null}
            needsWorkingCopySync={false}
          />
          <FrameChip
            label="尾帧图"
            token={props.token}
            relativePath={props.node.output?.lastFrameRelativePath ?? null}
            needsWorkingCopySync={false}
          />
          <p className="field-reason" data-last-frame-note="">
            {COPY.lastFrameApproximate}
          </p>
          <p className="media-duration" data-duration="">
            {formatDuration(props.node.output?.durationMs ?? null)}
          </p>
        </div>
      ) : null}
      {showRegen ? (
        <div className="btn-with-reason">
          <p className="field-reason">{COPY.videoFileWithoutPreview}</p>
          <button
            type="button"
            className="btn btn-secondary"
            data-regenerate-preview=""
            disabled={props.offline}
            onClick={() => {
              props.onRegeneratePreview?.(props.node.id);
            }}
          >
            {COPY.regeneratePreview}
          </button>
        </div>
      ) : null}
    </>
  );
}

function readErrorSecond(lines: { detail: string | null } | null): string | null {
  if (lines === null) {
    return null;
  }
  const { detail } = lines;
  return detail;
}

function InspectorSlot(props: {
  slot: Slot;
  slots: readonly Slot[];
  nodes: Record<string, ProjectNode>;
  edges: Record<string, ProjectEdge>;
  required: boolean;
}): ReactElement {
  const title = slotTitle(props.slots, props.slot);
  const connected = props.slot.edgeId !== null;
  const source = slotSourceLine(props.slot, props.slots, props.nodes, props.edges);
  return (
    <li className="inspector-slot" data-slot-role={props.slot.role} data-slot-id={props.slot.id}>
      <span>{title}</span>
      <span className="node-slot-hint">
        {connected ? "" : props.required ? COPY.slotRequired : COPY.slotOptional}
      </span>
      {source !== null ? (
        <span className="field-reason" data-source-line="">
          {`来源 ${source}`}
        </span>
      ) : null}
    </li>
  );
}

function ParamField(props: {
  spec: CapabilityParamSpec;
  value: string | number | boolean | null;
  onChange: (value: string | number | boolean | null) => void;
}): ReactElement {
  const display =
    props.spec.key === "seed" && (props.value === RANDOM_SEED || props.value === COPY.seedRandom)
      ? COPY.seedRandom
      : props.value == null
        ? ""
        : String(props.value);
  if (props.spec.valueType === "bool") {
    return (
      <label className="field">
        <span>{props.spec.label}</span>
        <input
          type="checkbox"
          checked={props.value === true}
          onChange={(event) => {
            props.onChange(event.target.checked);
          }}
        />
      </label>
    );
  }
  const numeric = props.spec.valueType === "int" || props.spec.valueType === "float";
  return (
    <label className="field">
      <span>{props.spec.label}</span>
      <input
        type={numeric ? "number" : "text"}
        value={display}
        min={props.spec.min}
        max={props.spec.max}
        onChange={(event) => {
          const raw = event.target.value;
          if (props.spec.key === "seed") {
            props.onChange(raw === COPY.seedRandom ? RANDOM_SEED : raw);
            return;
          }
          if (numeric) {
            const parsed = props.spec.valueType === "int" ? Number.parseInt(raw, 10) : Number(raw);
            props.onChange(Number.isFinite(parsed) ? parsed : null);
            return;
          }
          props.onChange(raw);
        }}
      />
    </label>
  );
}

function RunButton(props: {
  label: string;
  dataRun: "this" | "downstream" | "selection";
  disabled: boolean;
  reason: string | null;
  onClick: () => void;
}): ReactElement {
  return (
    <div className="btn-with-reason">
      <button
        type="button"
        className="btn btn-secondary"
        data-run={props.dataRun}
        title={props.disabled && props.reason !== null ? props.reason : props.label}
        disabled={props.disabled}
        onClick={props.onClick}
      >
        {props.label}
      </button>
      {props.disabled && props.reason !== null ? (
        <span className="field-reason">{props.reason}</span>
      ) : null}
    </div>
  );
}

function runGateReason(offline: boolean, blocked: boolean): string | null {
  if (offline) {
    return COPY.runDisabledOffline;
  }
  if (blocked) {
    return COPY.workingCopyBlocksRun;
  }
  return null;
}

function kindLabel(node: ProjectNode): string {
  if (node.kind === "generation") {
    return COPY.generationKindLabel;
  }
  return MEDIA_KIND_LABELS[node.kind];
}
