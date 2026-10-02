import type {
  Camera,
  CanvasProjectFile,
  ConnectTarget,
  MediaRef,
  ProjectEdge,
  ProjectGroup,
  ProjectNode,
  RunRequest,
  SlotRole,
  Variant,
  WorkingCopyPutBody,
} from "@canvas/schema";
import {
  applyStaleFrom,
  capabilityByProfileId,
  DEFAULT_NODE_SIZE,
  evaluateConnect,
  fingerprintNode,
  generationBadge,
  isTextOverLimit,
  listRecipes,
  markNodeStale,
  MEDIA_KIND_LABELS,
  ROLE_ACCEPTS,
  SERVER_AUTHORITATIVE_NODE_FIELDS,
  USER_FACING,
  VARIANT_POINTER_FIELDS,
} from "@canvas/schema";
import { DEFAULT_CAMERA, normalizeCamera } from "./coords.ts";
import {
  addableRolesForNode,
  cameraOf,
  canExtractVariant,
  cloneSubgraphForPaste,
  createAuthoredTextNode,
  createDetachedMediaNode,
  createGenerationNode,
  createImportedImageNode,
  createImportedVideoNode,
  createImportedAudioNode,
  generationHeightFor,
  expandSelectionToNodes,
  findVariant,
  generationNodeCount,
  hasPromptEdge,
  isContentUnsaved,
  isProjectEmpty,
  maxNodeZ,
  reindexSlots,
  textNodeCount,
  variantStripCount,
} from "./document.ts";
import {
  applyOps,
  CommandHistory,
  createHistoryEntry,
  moveNodesEntry,
  textCoalesceKey,
  type HistoryEntry,
  type Op,
} from "./history.ts";
import {
  buildRunRequest,
  nodeRunForce,
  selectionHasGeneration,
  selectionRunForce,
} from "../execution/runRequest.ts";
import { COPY } from "../ui/copy.ts";
import { COPY_OFFSET, GENERATION_WIDTH, TEXT_COALESCE_MS, generationNodeHeight } from "./metrics.ts";
import { snapWorldDelta } from "./snap.ts";
import { createSpatialIndex, type WorldRect } from "./spatialIndex.ts";

export type EditorSnapshot = {
  project: CanvasProjectFile | null;
  camera: Camera;
  unsaved: boolean;
  workingCopyBlocked: boolean;
  needsWorkingCopySync: boolean;
  empty: boolean;
  nodes: ProjectNode[];
  selectedIds: string[];
  selectedEdgeIds: string[];
  selectedCount: number;
  gestureActive: boolean;
  gestureKind: StoreGestureKind;
  canUndo: boolean;
  canRedo: boolean;
  lastEmittedRunRequest: RunRequest | null;
  lastConnectMessage: string | null;
};

export type ConnectResult =
  | { ok: true; replace: boolean }
  | { ok: false; message: string };

export type RunEmitResult =
  | { ok: true; request: RunRequest }
  | { ok: false; message: string; needsConfirm?: boolean; confirmMessage?: string | null };

export type SetTextResult =
  | { ok: true; changed: boolean }
  | { ok: false; message: string };

export type GroupResult =
  | { ok: true; groupId: string }
  | { ok: false; message: string };

export type ExecutionCancelHook = (nodeIds: readonly string[]) => void;

export type StoreGestureKind =
  | "idle"
  | "pending"
  | "pan"
  | "move"
  | "marquee"
  | "connect"
  | "extract"
  | "reorder-slot";

type PendingNodePatch = {
  nodeId: string;
  patch: Partial<ProjectNode>;
  meta?: { contentRevision?: number; executionRevision?: number };
};

const PATCH_IGNORE_KEYS = new Set(["x", "y", "width", "z", "id"]);

function versionHeightOp(nodeId: string, node: ProjectNode, versionId: string): Op | null {
  const height = generationHeightFor({
    slots: node.slots,
    versions: node.versions,
    currentVersionId: versionId,
  });
  if (height === node.height) {
    return null;
  }
  return {
    op: "set",
    path: `nodes.${nodeId}.height`,
    value: height,
    prev: node.height,
  };
}

function versionFreshnessOp(
  nodeId: string,
  node: ProjectNode,
  versionId: string,
  project: CanvasProjectFile,
): Op | null {
  const version = (node.versions ?? []).find((item) => item.id === versionId);
  if (version === undefined) {
    return null;
  }
  const fp = fingerprintNode(node, project.nodes, project.edges);
  const next = version.fingerprint === fp ? "fresh" : "stale";
  const prev = node.freshness ?? "fresh";
  if (next === prev) {
    return null;
  }
  return {
    op: "set",
    path: `nodes.${nodeId}.freshness`,
    value: next,
    prev,
  };
}

function chosenVariant(version: NonNullable<ProjectNode["versions"]>[number]): Variant | null {
  for (let index = version.variants.length - 1; index >= 0; index -= 1) {
    const variant = version.variants[index];
    if (variant !== undefined && variant.phase === "succeeded") {
      return variant;
    }
  }
  const last = version.variants[version.variants.length - 1];
  return last ?? null;
}

export type EditorStoreOptions = {
  idFactory?: () => string;
  now?: () => Date;
  onCancelExecution?: ExecutionCancelHook;
};

export class EditorStore {
  private readonly idFactory: () => string;
  private readonly now: () => Date;
  private project: CanvasProjectFile | null = null;
  private camera: Camera = DEFAULT_CAMERA;
  private localUnsaved = false;
  private workingCopyBlocked = false;
  private pendingWorkingCopy = false;
  private syncGen = 0;
  private snapshot: EditorSnapshot;
  private readonly listeners = new Set<() => void>();
  private readonly spatial = createSpatialIndex();
  private readonly history: CommandHistory;
  private selectedIds = new Set<string>();
  private selectedEdgeIds = new Set<string>();
  private gestureActive = false;
  private gestureKind: StoreGestureKind = "idle";
  private pendingPatches: PendingNodePatch[] = [];
  private clipboard: {
    nodes: Record<string, ProjectNode>;
    edges: Record<string, ProjectEdge>;
    groups: Record<string, ProjectGroup>;
    selectedIds: string[];
  } | null = null;
  private altStage: {
    nodeIds: string[];
    edgeIds: string[];
    groupIds: string[];
    selectBefore: string[];
  } | null = null;
  private lastTextAt = 0;
  private lastTextKey: string | null = null;
  private cancelHook: ExecutionCancelHook | null;
  private lastEmittedRunRequest: RunRequest | null = null;
  private lastConnectMessage: string | null = null;

  constructor(options: EditorStoreOptions = {}) {
    this.idFactory = options.idFactory ?? (() => crypto.randomUUID());
    this.now = options.now ?? (() => new Date());
    this.history = new CommandHistory({ idFactory: this.idFactory });
    this.cancelHook = options.onCancelExecution ?? null;
    this.snapshot = this.buildSnapshot();
    this.subscribe = this.subscribe.bind(this);
    this.getSnapshot = this.getSnapshot.bind(this);
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  getSnapshot(): EditorSnapshot {
    return this.snapshot;
  }

  hasProject(): boolean {
    return this.project !== null;
  }

  syncGeneration(): number {
    return this.syncGen;
  }

  setCancelHook(hook: ExecutionCancelHook | null): void {
    this.cancelHook = hook;
  }

  loadProject(project: CanvasProjectFile): void {
    this.project = structuredClone(project);
    this.camera = normalizeCamera(cameraOf(this.project));
    this.project.viewport = this.camera;
    this.localUnsaved = isContentUnsaved(this.project);
    this.workingCopyBlocked = false;
    this.pendingWorkingCopy = false;
    this.syncGen = 0;
    this.selectedIds.clear();
    this.selectedEdgeIds.clear();
    this.history.clear();
    this.clipboard = null;
    this.gestureActive = false;
    this.gestureKind = "idle";
    this.pendingPatches = [];
    this.lastEmittedRunRequest = null;
    this.lastConnectMessage = null;
    this.rebuildSpatial();
    this.emit();
  }

  clear(): void {
    this.project = null;
    this.camera = DEFAULT_CAMERA;
    this.localUnsaved = false;
    this.workingCopyBlocked = false;
    this.pendingWorkingCopy = false;
    this.syncGen = 0;
    this.selectedIds.clear();
    this.selectedEdgeIds.clear();
    this.history.clear();
    this.clipboard = null;
    this.gestureActive = false;
    this.gestureKind = "idle";
    this.pendingPatches = [];
    this.lastEmittedRunRequest = null;
    this.lastConnectMessage = null;
    this.spatial.clear();
    this.emit();
  }

  workingCopyBody(): WorkingCopyPutBody | null {
    if (this.project === null) {
      return null;
    }
    return {
      contentRevision: this.project.contentRevision,
      nodes: structuredClone(this.project.nodes),
      edges: structuredClone(this.project.edges),
      groups: structuredClone(this.project.groups),
    };
  }

  acknowledgeWorkingCopy(contentRevision: number, generation: number): void {
    if (this.project === null) {
      return;
    }
    this.project = {
      ...this.project,
      contentRevision,
    };
    if (generation === this.syncGen) {
      this.pendingWorkingCopy = false;
    }
    this.workingCopyBlocked = false;
    this.emit();
  }

  markWorkingCopyBlocked(): void {
    this.workingCopyBlocked = true;
    this.emit();
  }

  markSaved(contentRevision: number, savedContentRevision: number): void {
    if (this.project === null) {
      return;
    }
    this.project = {
      ...this.project,
      contentRevision,
      savedContentRevision,
    };
    this.localUnsaved = false;
    this.emit();
  }

  setCamera(camera: Camera): void {
    const next = normalizeCamera(camera);
    this.camera = next;
    if (this.project !== null) {
      this.project = {
        ...this.project,
        viewport: next,
      };
    }
    this.emit();
  }

  setGestureActive(active: boolean, kind?: StoreGestureKind): void {
    if (active) {
      this.gestureActive = true;
      if (kind !== undefined) {
        this.gestureKind = kind;
      }
      this.emit();
      return;
    }
    this.gestureActive = false;
    this.gestureKind = "idle";
    this.flushPendingPatches();
    this.emit();
  }

  select(ids: readonly string[], edgeIds: readonly string[] = []): void {
    const nextNodes = new Set(ids);
    const nextEdges = new Set(edgeIds);
    if (setsEqual(this.selectedIds, nextNodes) && setsEqual(this.selectedEdgeIds, nextEdges)) {
      return;
    }
    this.selectedIds = nextNodes;
    this.selectedEdgeIds = nextEdges;
    this.emit();
  }

  toggleSelect(id: string): void {
    const next = new Set(this.selectedIds);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    this.selectedIds = next;
    this.selectedEdgeIds = new Set();
    this.emit();
  }

  selectAll(): void {
    if (this.project === null) {
      return;
    }
    this.selectedIds = new Set(Object.keys(this.project.nodes));
    this.selectedEdgeIds = new Set();
    this.emit();
  }

  marqueeSelect(ids: readonly string[], additive: boolean): void {
    if (additive) {
      const next = new Set(this.selectedIds);
      for (const id of ids) {
        next.add(id);
      }
      this.selectedIds = next;
    } else {
      this.selectedIds = new Set(ids);
    }
    this.selectedEdgeIds = new Set();
    this.emit();
  }

  addTextNode(): string | null {
    if (this.project === null) {
      return null;
    }
    const id = this.idFactory();
    const serial = textNodeCount(this.project.nodes) + 1;
    const node = createAuthoredTextNode({
      id,
      title: `${COPY.textKindLabel} ${serial}`,
      x: this.camera.x - DEFAULT_NODE_SIZE.text.width / 2,
      y: this.camera.y - DEFAULT_NODE_SIZE.text.height / 2,
      z: maxNodeZ(this.project.nodes) + 1,
      now: this.now(),
    });
    this.commit(
      createHistoryEntry({
        label: "添加文本节点",
        redo: [{ op: "put-node", node }],
        selectAfterRedo: [id],
        selectAfterUndo: [...this.selectedIds],
      }),
    );
    return id;
  }

  addGenerationNode(profileId: string): string | null {
    if (this.project === null) {
      return null;
    }
    const descriptor = capabilityByProfileId(profileId);
    if (descriptor === null || descriptor.implemented !== true) {
      return null;
    }
    const id = this.idFactory();
    const serial = generationNodeCount(this.project.nodes) + 1;
    const node = createGenerationNode({
      profileId,
      idFactory: this.idFactory,
      id,
      title: `${descriptor.displayName} ${serial}`,
      x: this.camera.x - GENERATION_WIDTH / 2,
      y: this.camera.y - 120,
      z: maxNodeZ(this.project.nodes) + 1,
      now: this.now(),
    });
    if (node === null) {
      return null;
    }
    this.commit(
      createHistoryEntry({
        label: `添加${descriptor.displayName}`,
        redo: [{ op: "put-node", node }],
        selectAfterRedo: [id],
        selectAfterUndo: [...this.selectedIds],
      }),
    );
    return id;
  }

  /** @deprecated 用 addGenerationNode(profileId) */
  addGenerationShell(): string | null {
    return this.addGenerationNode("txt2img");
  }

  setText(nodeId: string, text: string): SetTextResult {
    if (this.project === null) {
      return { ok: true, changed: false };
    }
    const node = this.project.nodes[nodeId];
    if (node === undefined || node.kind !== "text") {
      return { ok: true, changed: false };
    }
    if (isTextOverLimit(text)) {
      return { ok: false, message: COPY.textTooLong };
    }
    const prev = node.text ?? "";
    if (prev === text) {
      return { ok: true, changed: false };
    }
    const nowMs = this.now().getTime();
    const key = textCoalesceKey(nodeId, "text");
    if (this.lastTextKey !== key || nowMs - this.lastTextAt > TEXT_COALESCE_MS) {
      this.history.seal();
    }
    this.lastTextKey = key;
    this.lastTextAt = nowMs;
    const updatedAt = this.now().toISOString();
    const redo: Op[] = [
      { op: "set", path: `nodes.${nodeId}.text`, value: text, prev },
      {
        op: "set",
        path: `nodes.${nodeId}.outputRevision`,
        value: node.outputRevision + 1,
        prev: node.outputRevision,
      },
      { op: "set", path: `nodes.${nodeId}.updatedAt`, value: updatedAt, prev: node.updatedAt },
    ];
    redo.push(...this.staleOps(nodeId, false));
    this.commit(
      createHistoryEntry({
        label: "编辑文本",
        redo,
        coalesceKey: key,
        selectAfterRedo: [nodeId],
        selectAfterUndo: [nodeId],
      }),
    );
    return { ok: true, changed: true };
  }

  /**
   * 只换 nodes/edges/groups，保留 this.project.contentRevision。
   * 调用方不要自己 putWorkingCopy。
   */
  replaceGraph(input: {
    nodes: Record<string, ProjectNode>;
    edges: Record<string, ProjectEdge>;
    groups: Record<string, ProjectGroup>;
  }): void {
    if (this.project === null) {
      return;
    }
    this.project = {
      ...this.project,
      nodes: structuredClone(input.nodes),
      edges: structuredClone(input.edges),
      groups: structuredClone(input.groups),
      updatedAt: this.now().toISOString(),
    };
    this.selectedIds.clear();
    this.selectedEdgeIds.clear();
    this.history.clear();
    this.rebuildSpatial();
    this.markContentChanged();
    this.emit();
  }

  applyNodePatch(
    nodeId: string,
    patch: Partial<ProjectNode>,
    meta?: { contentRevision?: number; executionRevision?: number },
  ): void {
    if (this.gestureKind === "move") {
      this.pendingPatches.push({ nodeId, patch: structuredClone(patch), meta });
      return;
    }
    this.applyNodePatchNow(nodeId, patch, meta);
  }

  applyVariantFinished(nodeId: string, variant: Variant): void {
    if (this.project === null) {
      return;
    }
    const node = this.project.nodes[nodeId];
    if (node === undefined || node.versions === undefined || node.versions.length === 0) {
      return;
    }
    let changed = false;
    const versions = node.versions.map((version) => {
      const index = version.variants.findIndex(
        (item) => item.id === variant.id || item.index === variant.index,
      );
      if (index < 0) {
        return version;
      }
      changed = true;
      const variants = version.variants.slice();
      variants[index] = structuredClone(variant);
      return { ...version, variants };
    });
    if (!changed) {
      return;
    }
    this.project.nodes[nodeId] = { ...node, versions };
    this.emit();
  }

  applyProgressForTask(
    taskId: string,
    progress: { ratio: number | null; label: string | null },
  ): void {
    if (this.project === null) {
      return;
    }
    for (const node of Object.values(this.project.nodes)) {
      if (node.lastTaskId === taskId) {
        this.applyNodePatch(node.id, { progress });
        return;
      }
    }
  }

  absorbServerFields(server: CanvasProjectFile): void {
    if (this.project === null) {
      return;
    }
    const nodes: Record<string, ProjectNode> = { ...this.project.nodes };
    for (const [id, local] of Object.entries(nodes)) {
      const remote = server.nodes[id];
      if (remote === undefined) {
        continue;
      }
      const merged: ProjectNode = { ...local };
      for (const key of VARIANT_POINTER_FIELDS) {
        copyNodeField(merged, remote, key);
      }
      for (const key of SERVER_AUTHORITATIVE_NODE_FIELDS) {
        copyNodeField(merged, remote, key);
      }
      if (merged.kind === "generation") {
        merged.height = generationHeightFor(merged);
      }
      nodes[id] = merged;
    }
    this.project = {
      ...this.project,
      nodes,
      contentRevision: server.contentRevision,
    };
    this.workingCopyBlocked = false;
    this.rebuildSpatial();
    this.emit();
  }

  addImportedImage(media: MediaRef, world: { x: number; y: number }): string | null {
    if (this.project === null) {
      return null;
    }
    const id = this.idFactory();
    let serial = 0;
    for (const node of Object.values(this.project.nodes)) {
      if (node.kind === "image" && node.origin === "imported") {
        serial += 1;
      }
    }
    const node = createImportedImageNode({
      id,
      title: `${MEDIA_KIND_LABELS.image} ${serial + 1}`,
      x: world.x - DEFAULT_NODE_SIZE.image.width / 2,
      y: world.y - DEFAULT_NODE_SIZE.image.minHeight / 2,
      z: maxNodeZ(this.project.nodes) + 1,
      now: this.now(),
      media,
    });
    this.commit(
      createHistoryEntry({
        label: "导入图片",
        redo: [{ op: "put-node", node }],
        selectAfterRedo: [id],
        selectAfterUndo: [...this.selectedIds],
      }),
    );
    return id;
  }

  addImportedVideo(media: MediaRef, world: { x: number; y: number }): string | null {
    if (this.project === null || media.kind !== "video") {
      return null;
    }
    const id = this.idFactory();
    let serial = 0;
    for (const node of Object.values(this.project.nodes)) {
      if (node.kind === "video" && node.origin === "imported") {
        serial += 1;
      }
    }
    const node = createImportedVideoNode({
      id,
      title: `${MEDIA_KIND_LABELS.video} ${serial + 1}`,
      x: world.x - DEFAULT_NODE_SIZE.video.width / 2,
      y: world.y - DEFAULT_NODE_SIZE.video.minHeight / 2,
      z: maxNodeZ(this.project.nodes) + 1,
      now: this.now(),
      media,
    });
    this.commit(
      createHistoryEntry({
        label: "导入视频",
        redo: [{ op: "put-node", node }],
        selectAfterRedo: [id],
        selectAfterUndo: [...this.selectedIds],
      }),
    );
    return id;
  }

  addImportedAudio(media: MediaRef, world: { x: number; y: number }): string | null {
    if (this.project === null || media.kind !== "audio") {
      return null;
    }
    const id = this.idFactory();
    let serial = 0;
    for (const node of Object.values(this.project.nodes)) {
      if (node.kind === "audio" && node.origin === "imported") {
        serial += 1;
      }
    }
    const node = createImportedAudioNode({
      id,
      title: `${MEDIA_KIND_LABELS.audio} ${serial + 1}`,
      x: world.x - DEFAULT_NODE_SIZE.audio.width / 2,
      y: world.y - DEFAULT_NODE_SIZE.audio.height / 2,
      z: maxNodeZ(this.project.nodes) + 1,
      now: this.now(),
      media,
    });
    this.commit(
      createHistoryEntry({
        label: "导入音频",
        redo: [{ op: "put-node", node }],
        selectAfterRedo: [id],
        selectAfterUndo: [...this.selectedIds],
      }),
    );
    return id;
  }

  setGenerationRecipe(nodeId: string, recipeId: string): boolean {
    if (this.project === null) {
      return false;
    }
    const node = this.project.nodes[nodeId];
    if (node === undefined || node.kind !== "generation") {
      return false;
    }
    const recipe = listRecipes().find(
      (item) => item.id === recipeId && item.profileId === node.profileId && item.enabled && item.implemented,
    );
    if (recipe === undefined) {
      return false;
    }
    const secretRef =
      recipe.requiresSecret && recipe.providerId !== undefined
        ? { providerId: recipe.providerId, account: "default" }
        : null;
    const updatedAt = this.now().toISOString();
    const redo: Op[] = [
      { op: "set", path: `nodes.${nodeId}.recipeId`, value: recipe.id, prev: node.recipeId ?? null },
      { op: "set", path: `nodes.${nodeId}.recipeVersion`, value: recipe.version, prev: node.recipeVersion ?? null },
      { op: "set", path: `nodes.${nodeId}.secretRef`, value: secretRef, prev: node.secretRef ?? null },
      { op: "set", path: `nodes.${nodeId}.updatedAt`, value: updatedAt, prev: node.updatedAt },
      ...this.staleOps(nodeId, true),
    ];
    this.commit(
      createHistoryEntry({
        label: "换配方",
        redo,
        selectAfterRedo: [nodeId],
        selectAfterUndo: [...this.selectedIds],
      }),
    );
    return true;
  }

  moveNodes(ids: readonly string[], dx: number, dy: number, snap = true): void {
    if (this.project === null) {
      return;
    }
    const movingIds = expandSelectionToNodes(this.project.nodes, this.project.groups, ids);
    if (movingIds.length === 0) {
      return;
    }
    let nextDx = dx;
    let nextDy = dy;
    if (snap) {
      const movingRects = [];
      const others = [];
      const movingSet = new Set(movingIds);
      for (const node of Object.values(this.project.nodes)) {
        const rect = { id: node.id, x: node.x, y: node.y, width: node.width, height: node.height };
        if (movingSet.has(node.id)) {
          movingRects.push(rect);
        } else {
          others.push(rect);
        }
      }
      const snapped = snapWorldDelta(movingRects, others, dx, dy, this.camera.zoom);
      nextDx = snapped.dx;
      nextDy = snapped.dy;
    }
    if (nextDx === 0 && nextDy === 0) {
      this.setGestureActive(false);
      return;
    }
    const moves = [];
    for (const id of movingIds) {
      const node = this.project.nodes[id];
      if (node === undefined) {
        continue;
      }
      moves.push({
        id,
        prev: { x: node.x, y: node.y },
        next: { x: node.x + nextDx, y: node.y + nextDy },
      });
    }
    if (moves.length === 0) {
      this.setGestureActive(false);
      return;
    }
    this.setGestureActive(false);
    this.commit(
      moveNodesEntry({
        moves,
        select: [...this.selectedIds],
      }),
    );
  }

  groupSelected(): GroupResult {
    if (this.project === null) {
      return { ok: false, message: COPY.groupNeedTwo };
    }
    const childIds = expandSelectionToNodes(
      this.project.nodes,
      this.project.groups,
      [...this.selectedIds],
    );
    if (childIds.length < 2) {
      return { ok: false, message: COPY.groupNeedTwo };
    }
    const groupId = this.idFactory();
    const group: ProjectGroup = { id: groupId, title: "分组", childIds };
    const redo: Op[] = [{ op: "put-group", group }];
    for (const id of childIds) {
      const node = this.project.nodes[id];
      if (node === undefined) {
        continue;
      }
      redo.push({
        op: "set",
        path: `nodes.${id}.groupId`,
        value: groupId,
        prev: node.groupId,
      });
    }
    this.commit(
      createHistoryEntry({
        label: "成组",
        redo,
        selectAfterRedo: [groupId],
        selectAfterUndo: [...this.selectedIds],
      }),
    );
    return { ok: true, groupId };
  }

  ungroupSelected(): void {
    if (this.project === null) {
      return;
    }
    const redo: Op[] = [];
    const groupIds: string[] = [];
    for (const id of this.selectedIds) {
      const group = this.project.groups[id];
      if (group === undefined) {
        continue;
      }
      groupIds.push(id);
      redo.push({ op: "drop-group", id, group: structuredClone(group) });
      for (const childId of group.childIds) {
        const node = this.project.nodes[childId];
        if (node === undefined) {
          continue;
        }
        redo.push({
          op: "set",
          path: `nodes.${childId}.groupId`,
          value: null,
          prev: node.groupId,
        });
      }
    }
    if (redo.length === 0) {
      return;
    }
    this.commit(
      createHistoryEntry({
        label: "解散分组",
        redo,
        selectAfterRedo: groupIds.flatMap((id) => this.project?.groups[id]?.childIds ?? []),
        selectAfterUndo: [...this.selectedIds],
      }),
    );
  }

  copySelection(): void {
    if (this.project === null) {
      return;
    }
    const ids = [...this.selectedIds];
    if (ids.length === 0) {
      return;
    }
    this.clipboard = {
      nodes: structuredClone(this.project.nodes),
      edges: structuredClone(this.project.edges),
      groups: structuredClone(this.project.groups),
      selectedIds: ids,
    };
  }

  hasSessionClipboard(): boolean {
    return this.clipboard !== null && this.clipboard.selectedIds.length > 0;
  }

  pasteClipboard(): string[] {
    if (this.project === null || this.clipboard === null) {
      return [];
    }
    return this.pasteFrom(this.clipboard);
  }

  duplicateSelection(): string[] {
    if (this.project === null) {
      return [];
    }
    this.copySelection();
    return this.pasteClipboard();
  }

  /** Alt 拖：复制品与原来重合，先不入栈。取消时 discard。 */
  stageAltDuplicate(): string[] {
    if (this.project === null || this.altStage !== null) {
      return [];
    }
    const selectBefore = [...this.selectedIds];
    const cloned = cloneSubgraphForPaste({
      nodes: this.project.nodes,
      edges: this.project.edges,
      groups: this.project.groups,
      selectedIds: selectBefore,
      idFactory: this.idFactory,
      offset: { x: 0, y: 0 },
    });
    if (cloned.newNodeIds.length === 0) {
      return [];
    }
    for (const node of Object.values(cloned.nodes)) {
      this.project.nodes[node.id] = node;
    }
    for (const edge of Object.values(cloned.edges)) {
      this.project.edges[edge.id] = edge;
    }
    for (const group of Object.values(cloned.groups)) {
      this.project.groups[group.id] = group;
    }
    this.altStage = {
      nodeIds: [...cloned.newNodeIds],
      edgeIds: Object.keys(cloned.edges),
      groupIds: Object.keys(cloned.groups),
      selectBefore,
    };
    this.selectedIds = new Set(cloned.newNodeIds);
    this.selectedEdgeIds = new Set();
    this.rebuildSpatial();
    this.emit();
    return [...cloned.newNodeIds];
  }

  discardAltStage(): void {
    if (this.project === null || this.altStage === null) {
      return;
    }
    const stage = this.altStage;
    this.altStage = null;
    for (const id of stage.edgeIds) {
      delete this.project.edges[id];
    }
    for (const id of stage.groupIds) {
      delete this.project.groups[id];
    }
    for (const id of stage.nodeIds) {
      delete this.project.nodes[id];
    }
    this.selectedIds = new Set(stage.selectBefore);
    this.selectedEdgeIds = new Set();
    this.rebuildSpatial();
    this.emit();
  }

  /** 复制并移动合成一条命令。位移为 0 则复制也不留。 */
  commitAltMove(dx: number, dy: number): boolean {
    if (this.project === null || this.altStage === null) {
      return false;
    }
    const stage = this.altStage;
    const nodes = stage.nodeIds
      .map((id) => this.project?.nodes[id])
      .filter((node): node is ProjectNode => node !== undefined)
      .map((node) => ({ ...structuredClone(node), x: node.x + dx, y: node.y + dy }));
    const edges = stage.edgeIds
      .map((id) => this.project?.edges[id])
      .filter((edge): edge is ProjectEdge => edge !== undefined)
      .map((edge) => structuredClone(edge));
    const groups = stage.groupIds
      .map((id) => this.project?.groups[id])
      .filter((group): group is ProjectGroup => group !== undefined)
      .map((group) => structuredClone(group));
    this.altStage = null;
    for (const id of stage.edgeIds) {
      delete this.project.edges[id];
    }
    for (const id of stage.groupIds) {
      delete this.project.groups[id];
    }
    for (const id of stage.nodeIds) {
      delete this.project.nodes[id];
    }
    if (dx === 0 && dy === 0) {
      this.selectedIds = new Set(stage.selectBefore);
      this.selectedEdgeIds = new Set();
      this.rebuildSpatial();
      this.emit();
      return false;
    }
    const redo: Op[] = [];
    for (const node of nodes) {
      redo.push({ op: "put-node", node });
    }
    for (const edge of edges) {
      redo.push({ op: "put-edge", edge });
    }
    for (const group of groups) {
      redo.push({ op: "put-group", group });
    }
    this.commit(
      createHistoryEntry({
        label: `移动 ${nodes.length} 个节点`,
        redo,
        selectAfterRedo: stage.nodeIds,
        selectAfterUndo: stage.selectBefore,
      }),
    );
    return true;
  }

  addTextAt(text: string, world: { x: number; y: number }): string | null {
    if (this.project === null || text.length === 0 || isTextOverLimit(text)) {
      return null;
    }
    const id = this.idFactory();
    const serial = textNodeCount(this.project.nodes) + 1;
    const node = createAuthoredTextNode({
      id,
      title: `${COPY.textKindLabel} ${serial}`,
      x: world.x - DEFAULT_NODE_SIZE.text.width / 2,
      y: world.y - DEFAULT_NODE_SIZE.text.height / 2,
      z: maxNodeZ(this.project.nodes) + 1,
      now: this.now(),
      text,
    });
    this.commit(
      createHistoryEntry({
        label: "添加文本节点",
        redo: [{ op: "put-node", node }],
        selectAfterRedo: [id],
        selectAfterUndo: [...this.selectedIds],
      }),
    );
    return id;
  }

  addImportedBatch(
    items: readonly { media: MediaRef; world: { x: number; y: number } }[],
  ): string[] {
    if (this.project === null || items.length === 0) {
      return [];
    }
    const redo: Op[] = [];
    const ids: string[] = [];
    let imageSerial = 0;
    let videoSerial = 0;
    let audioSerial = 0;
    for (const node of Object.values(this.project.nodes)) {
      if (node.origin !== "imported") {
        continue;
      }
      if (node.kind === "image") {
        imageSerial += 1;
      } else if (node.kind === "video") {
        videoSerial += 1;
      } else if (node.kind === "audio") {
        audioSerial += 1;
      }
    }
    let z = maxNodeZ(this.project.nodes);
    for (const item of items) {
      const id = this.idFactory();
      z += 1;
      let node: ProjectNode | null = null;
      if (item.media.kind === "image") {
        imageSerial += 1;
        node = createImportedImageNode({
          id,
          title: `${MEDIA_KIND_LABELS.image} ${imageSerial}`,
          x: item.world.x - DEFAULT_NODE_SIZE.image.width / 2,
          y: item.world.y - DEFAULT_NODE_SIZE.image.minHeight / 2,
          z,
          now: this.now(),
          media: item.media,
        });
      } else if (item.media.kind === "video") {
        videoSerial += 1;
        node = createImportedVideoNode({
          id,
          title: `${MEDIA_KIND_LABELS.video} ${videoSerial}`,
          x: item.world.x - DEFAULT_NODE_SIZE.video.width / 2,
          y: item.world.y - DEFAULT_NODE_SIZE.video.minHeight / 2,
          z,
          now: this.now(),
          media: item.media,
        });
      } else if (item.media.kind === "audio") {
        audioSerial += 1;
        node = createImportedAudioNode({
          id,
          title: `${MEDIA_KIND_LABELS.audio} ${audioSerial}`,
          x: item.world.x - DEFAULT_NODE_SIZE.audio.width / 2,
          y: item.world.y - DEFAULT_NODE_SIZE.audio.height / 2,
          z,
          now: this.now(),
          media: item.media,
        });
      }
      if (node === null) {
        continue;
      }
      redo.push({ op: "put-node", node });
      ids.push(id);
    }
    if (redo.length === 0) {
      return [];
    }
    this.commit(
      createHistoryEntry({
        label: ids.length === 1 ? "导入文件" : `导入 ${ids.length} 个文件`,
        redo,
        selectAfterRedo: ids,
        selectAfterUndo: [...this.selectedIds],
      }),
    );
    return ids;
  }

  deleteSelection(): void {
    if (this.project === null) {
      return;
    }
    const nodeIds = new Set(
      expandSelectionToNodes(this.project.nodes, this.project.groups, [...this.selectedIds]),
    );
    for (const id of this.selectedIds) {
      const group = this.project.groups[id];
      if (group !== undefined) {
        for (const child of group.childIds) {
          nodeIds.add(child);
        }
      }
    }
    const cancelIds: string[] = [];
    for (const id of nodeIds) {
      const node = this.project.nodes[id];
      if (node !== undefined && (node.phase === "queued" || node.phase === "running")) {
        cancelIds.push(id);
      }
    }
    if (cancelIds.length > 0) {
      this.cancelHook?.(cancelIds);
    }
    const redo: Op[] = [];
    const droppedEdges = new Set<string>();
    for (const edge of Object.values(this.project.edges)) {
      if (
        nodeIds.has(edge.sourceNodeId) ||
        nodeIds.has(edge.targetNodeId) ||
        this.selectedEdgeIds.has(edge.id)
      ) {
        redo.push({ op: "drop-edge", id: edge.id, edge: structuredClone(edge) });
        droppedEdges.add(edge.id);
      }
    }
    const clearByNode = new Map<string, Set<string>>();
    for (const edgeId of droppedEdges) {
      const edge = this.project.edges[edgeId];
      if (edge === undefined || nodeIds.has(edge.targetNodeId)) {
        continue;
      }
      const slots = clearByNode.get(edge.targetNodeId) ?? new Set<string>();
      slots.add(edge.targetSlotId);
      clearByNode.set(edge.targetNodeId, slots);
    }
    for (const [targetId, slotIds] of clearByNode) {
      const target = this.project.nodes[targetId];
      if (target?.slots === undefined) {
        continue;
      }
      redo.push({
        op: "set",
        path: `nodes.${targetId}.slots`,
        value: target.slots.map((item) => (slotIds.has(item.id) ? { ...item, edgeId: null } : item)),
        prev: structuredClone(target.slots),
      });
    }
    for (const id of nodeIds) {
      const node = this.project.nodes[id];
      if (node !== undefined) {
        redo.push({ op: "drop-node", id, node: structuredClone(node) });
      }
    }
    for (const group of Object.values(this.project.groups)) {
      const remaining = group.childIds.filter((id) => !nodeIds.has(id));
      if (remaining.length < 2 || this.selectedIds.has(group.id)) {
        redo.push({ op: "drop-group", id: group.id, group: structuredClone(group) });
        for (const childId of remaining) {
          const child = this.project.nodes[childId];
          if (child !== undefined && !nodeIds.has(childId)) {
            redo.push({
              op: "set",
              path: `nodes.${childId}.groupId`,
              value: null,
              prev: child.groupId,
            });
          }
        }
      }
    }
    if (redo.length === 0) {
      return;
    }
    const staleFrom = new Set<string>();
    for (const op of redo) {
      if (op.op === "drop-edge") {
        staleFrom.add(op.edge.targetNodeId);
      }
    }
    for (const origin of staleFrom) {
      if (this.project.nodes[origin] !== undefined) {
        redo.push(...this.staleOps(origin, true));
      } else {
        redo.push(...this.staleOps(origin, false));
      }
    }
    const nodeCount = nodeIds.size;
    const label =
      nodeCount > 0 ? `删除 ${nodeCount} 个节点` : droppedEdges.size > 0 ? "断开连线" : "删除";
    this.commit(
      createHistoryEntry({
        label,
        redo,
        selectAfterRedo: [],
        selectAfterUndo: [...this.selectedIds],
      }),
    );
  }

  disconnectSlot(nodeId: string, slotId: string): boolean {
    if (this.project === null) {
      return false;
    }
    const node = this.project.nodes[nodeId];
    if (node === undefined || node.slots === undefined) {
      return false;
    }
    const slot = node.slots.find((item) => item.id === slotId);
    if (slot === undefined || slot.edgeId === null) {
      return false;
    }
    const edge = this.project.edges[slot.edgeId];
    const redo: Op[] = [];
    if (edge !== undefined) {
      redo.push({ op: "drop-edge", id: edge.id, edge: structuredClone(edge) });
    }
    redo.push({
      op: "set",
      path: `nodes.${nodeId}.slots`,
      value: node.slots.map((item) => (item.id === slotId ? { ...item, edgeId: null } : item)),
      prev: structuredClone(node.slots),
    });
    redo.push(...this.staleOps(nodeId, true));
    this.commit(
      createHistoryEntry({
        label: "断开连线",
        redo,
        selectAfterRedo: [nodeId],
        selectAfterUndo: [...this.selectedIds],
      }),
    );
    return true;
  }

  /** 芯片拖到另一个槽：同一条边改目标。目标已占用则替换。一条命令。 */
  relocateSlotEdge(fromNodeId: string, fromSlotId: string, toNodeId: string, toSlotId: string): ConnectResult {
    if (this.project === null) {
      return this.rejectConnect(USER_FACING.connectToBlank);
    }
    if (fromNodeId === toNodeId && fromSlotId === toSlotId) {
      return { ok: false, message: USER_FACING.connectToBlank };
    }
    const fromNode = this.project.nodes[fromNodeId];
    const fromSlot = fromNode?.slots?.find((item) => item.id === fromSlotId);
    if (fromNode === undefined || fromSlot === undefined || fromSlot.edgeId === null) {
      return this.rejectConnect(USER_FACING.connectToBlank);
    }
    const edge = this.project.edges[fromSlot.edgeId];
    if (edge === undefined) {
      return this.rejectConnect(USER_FACING.connectToBlank);
    }
    const evaluation = evaluateConnect({
      nodes: this.project.nodes,
      edges: this.project.edges,
      sourceNodeId: edge.sourceNodeId,
      target: { type: "slot", nodeId: toNodeId, slotId: toSlotId },
    });
    if (!evaluation.ok) {
      return this.rejectConnect(evaluation.message);
    }
    const toNode = this.project.nodes[toNodeId];
    const toSlot = toNode?.slots?.find((item) => item.id === toSlotId);
    if (toNode === undefined || toNode.slots === undefined || toSlot === undefined) {
      return this.rejectConnect(USER_FACING.connectToBlank);
    }
    const redo: Op[] = [{ op: "drop-edge", id: edge.id, edge: structuredClone(edge) }];
    if (toSlot.edgeId !== null && toSlot.edgeId !== edge.id) {
      const replaced = this.project.edges[toSlot.edgeId];
      if (replaced !== undefined) {
        redo.push({ op: "drop-edge", id: replaced.id, edge: structuredClone(replaced) });
      }
    }
    const moved: ProjectEdge = {
      ...structuredClone(edge),
      targetNodeId: toNodeId,
      targetSlotId: toSlotId,
      role: toSlot.role,
    };
    redo.push({ op: "put-edge", edge: moved });
    if (fromNodeId === toNodeId && fromNode.slots !== undefined) {
      redo.push({
        op: "set",
        path: `nodes.${fromNodeId}.slots`,
        value: fromNode.slots.map((item) => {
          if (item.id === fromSlotId) {
            return { ...item, edgeId: null };
          }
          if (item.id === toSlotId) {
            return { ...item, edgeId: edge.id };
          }
          return item;
        }),
        prev: structuredClone(fromNode.slots),
      });
    } else {
      if (fromNode.slots !== undefined) {
        redo.push({
          op: "set",
          path: `nodes.${fromNodeId}.slots`,
          value: fromNode.slots.map((item) => (item.id === fromSlotId ? { ...item, edgeId: null } : item)),
          prev: structuredClone(fromNode.slots),
        });
      }
      redo.push({
        op: "set",
        path: `nodes.${toNodeId}.slots`,
        value: toNode.slots.map((item) => (item.id === toSlotId ? { ...item, edgeId: edge.id } : item)),
        prev: structuredClone(toNode.slots),
      });
    }
    redo.push(...this.staleOps(fromNodeId, true));
    if (toNodeId !== fromNodeId) {
      redo.push(...this.staleOps(toNodeId, true));
    }
    this.lastConnectMessage = null;
    this.commit(
      createHistoryEntry({
        label: evaluation.replace ? "更换槽上的连线" : "移动连线",
        redo,
        selectAfterRedo: [edge.sourceNodeId, toNodeId],
        selectAfterUndo: [...this.selectedIds],
      }),
    );
    return evaluation;
  }

  connect(sourceNodeId: string, target: ConnectTarget): ConnectResult {
    if (this.project === null) {
      return this.rejectConnect(USER_FACING.connectToBlank);
    }
    const evaluation = evaluateConnect({
      nodes: this.project.nodes,
      edges: this.project.edges,
      sourceNodeId,
      target,
    });
    if (!evaluation.ok) {
      return this.rejectConnect(evaluation.message);
    }
    if (target.type !== "slot") {
      return this.rejectConnect(USER_FACING.connectToBlank);
    }
    const targetNode = this.project.nodes[target.nodeId];
    if (targetNode === undefined || targetNode.slots === undefined) {
      return this.rejectConnect(USER_FACING.connectToBlank);
    }
    const slot = targetNode.slots.find((item) => item.id === target.slotId);
    if (slot === undefined) {
      return this.rejectConnect(USER_FACING.connectToBlank);
    }
    const redo: Op[] = [];
    if (slot.edgeId !== null) {
      const old = this.project.edges[slot.edgeId];
      if (old !== undefined) {
        redo.push({ op: "drop-edge", id: old.id, edge: structuredClone(old) });
      }
    }
    const edgeId = this.idFactory();
    const edge: ProjectEdge = {
      id: edgeId,
      sourceNodeId,
      targetNodeId: target.nodeId,
      targetSlotId: target.slotId,
      role: slot.role,
    };
    redo.push({ op: "put-edge", edge });
    redo.push({
      op: "set",
      path: `nodes.${target.nodeId}.slots`,
      value: targetNode.slots.map((item) =>
        item.id === target.slotId ? { ...item, edgeId } : item,
      ),
      prev: structuredClone(targetNode.slots),
    });
    redo.push(...this.staleOps(target.nodeId, true));
    this.lastConnectMessage = null;
    this.commit(
      createHistoryEntry({
        label: "连线",
        redo,
        selectAfterRedo: [sourceNodeId, target.nodeId],
        selectAfterUndo: [...this.selectedIds],
      }),
    );
    return evaluation;
  }

  connectToSlot(sourceNodeId: string, targetNodeId: string, targetSlotId: string): ConnectResult {
    return this.connect(sourceNodeId, { type: "slot", nodeId: targetNodeId, slotId: targetSlotId });
  }

  connectInsert(
    sourceNodeId: string,
    targetNodeId: string,
    role: SlotRole,
    insertOrder: number,
  ): ConnectResult {
    const added = this.addSlot(targetNodeId, role, insertOrder);
    if (!added.ok) {
      return { ok: false, message: added.message };
    }
    const connected = this.connectToSlot(sourceNodeId, targetNodeId, added.slotId);
    if (!connected.ok) {
      this.undo();
      return connected;
    }
    return connected;
  }

  setPromptDraft(nodeId: string, text: string): SetTextResult {
    if (this.project === null) {
      return { ok: true, changed: false };
    }
    const node = this.project.nodes[nodeId];
    if (node === undefined || node.kind !== "generation") {
      return { ok: true, changed: false };
    }
    if (isTextOverLimit(text)) {
      return { ok: false, message: COPY.textTooLong };
    }
    const prev = node.promptDraft ?? "";
    if (prev === text) {
      return { ok: true, changed: false };
    }
    const nowMs = this.now().getTime();
    const key = textCoalesceKey(nodeId, "promptDraft");
    if (this.lastTextKey !== key || nowMs - this.lastTextAt > TEXT_COALESCE_MS) {
      this.history.seal();
    }
    this.lastTextKey = key;
    this.lastTextAt = nowMs;
    const updatedAt = this.now().toISOString();
    const redo: Op[] = [
      { op: "set", path: `nodes.${nodeId}.promptDraft`, value: text, prev },
      { op: "set", path: `nodes.${nodeId}.updatedAt`, value: updatedAt, prev: node.updatedAt },
    ];
    if (!hasPromptEdge(node)) {
      redo.push(...this.staleOps(nodeId, true));
    }
    this.commit(
      createHistoryEntry({
        label: "编辑提示词草稿",
        redo,
        coalesceKey: key,
        selectAfterRedo: [nodeId],
        selectAfterUndo: [nodeId],
      }),
    );
    return { ok: true, changed: true };
  }

  setParams(nodeId: string, params: Record<string, string | number | boolean | null>): boolean {
    if (this.project === null) {
      return false;
    }
    const node = this.project.nodes[nodeId];
    if (node === undefined || node.kind !== "generation") {
      return false;
    }
    const prev = structuredClone(node.params ?? {});
    const updatedAt = this.now().toISOString();
    const redo: Op[] = [
      { op: "set", path: `nodes.${nodeId}.params`, value: structuredClone(params), prev },
      { op: "set", path: `nodes.${nodeId}.updatedAt`, value: updatedAt, prev: node.updatedAt },
      ...this.staleOps(nodeId, true),
    ];
    this.commit(
      createHistoryEntry({
        label: "改参数",
        redo,
        selectAfterRedo: [nodeId],
        selectAfterUndo: [...this.selectedIds],
      }),
    );
    return true;
  }

  setVariantCount(nodeId: string, count: number): boolean {
    if (this.project === null) {
      return false;
    }
    const node = this.project.nodes[nodeId];
    if (node === undefined || node.kind !== "generation") {
      return false;
    }
    const next = Math.min(4, Math.max(1, Math.trunc(count)));
    if (next === (node.variantCount ?? 1)) {
      return true;
    }
    const updatedAt = this.now().toISOString();
    const redo: Op[] = [
      { op: "set", path: `nodes.${nodeId}.variantCount`, value: next, prev: node.variantCount ?? 1 },
      { op: "set", path: `nodes.${nodeId}.updatedAt`, value: updatedAt, prev: node.updatedAt },
      ...this.staleOps(nodeId, true),
    ];
    this.commit(
      createHistoryEntry({
        label: USER_FACING.variantCountLabel,
        redo,
        selectAfterRedo: [nodeId],
        selectAfterUndo: [...this.selectedIds],
      }),
    );
    return true;
  }

  addSlot(
    nodeId: string,
    role: SlotRole,
    insertOrder?: number,
  ): { ok: true; slotId: string } | { ok: false; message: string } {
    if (this.project === null) {
      return { ok: false, message: USER_FACING.connectToBlank };
    }
    const node = this.project.nodes[nodeId];
    if (node === undefined || node.kind !== "generation") {
      return { ok: false, message: USER_FACING.connectToBlank };
    }
    const addable = addableRolesForNode(node);
    if (!addable.includes(role)) {
      return { ok: false, message: USER_FACING.notImplemented };
    }
    const slots = structuredClone(node.slots ?? []);
    let order = insertOrder;
    if (order === undefined) {
      const same = slots.filter((item) => item.role === role);
      if (same.length === 0) {
        order = slots.length;
      } else {
        order = Math.max(...same.map((item) => item.order)) + 1;
      }
    }
    for (const slot of slots) {
      if (slot.order >= order) {
        slot.order += 1;
      }
    }
    const slotId = this.idFactory();
    slots.push({ id: slotId, role, order, edgeId: null });
    const nextSlots = reindexSlots(slots);
    const height = generationNodeHeight(nextSlots.length, variantStripCount(node));
    const updatedAt = this.now().toISOString();
    const redo: Op[] = [
      { op: "set", path: `nodes.${nodeId}.slots`, value: nextSlots, prev: structuredClone(node.slots ?? []) },
      { op: "set", path: `nodes.${nodeId}.height`, value: height, prev: node.height },
      { op: "set", path: `nodes.${nodeId}.updatedAt`, value: updatedAt, prev: node.updatedAt },
      ...this.staleOps(nodeId, true),
    ];
    this.commit(
      createHistoryEntry({
        label: "添加槽",
        redo,
        selectAfterRedo: [nodeId],
        selectAfterUndo: [...this.selectedIds],
      }),
    );
    return { ok: true, slotId };
  }

  removeSlot(nodeId: string, slotId: string): boolean {
    if (this.project === null) {
      return false;
    }
    const node = this.project.nodes[nodeId];
    if (node === undefined || node.slots === undefined) {
      return false;
    }
    const slot = node.slots.find((item) => item.id === slotId);
    if (slot === undefined) {
      return false;
    }
    const descriptor = node.profileId != null ? capabilityByProfileId(node.profileId) : null;
    const spec = descriptor?.slots.find((item) => item.role === slot.role);
    const count = node.slots.filter((item) => item.role === slot.role).length;
    if (spec !== undefined && count <= spec.minCount) {
      return false;
    }
    const redo: Op[] = [];
    if (slot.edgeId !== null) {
      const old = this.project.edges[slot.edgeId];
      if (old !== undefined) {
        redo.push({ op: "drop-edge", id: old.id, edge: structuredClone(old) });
      }
    }
    const nextSlots = reindexSlots(node.slots.filter((item) => item.id !== slotId));
    const height = generationNodeHeight(nextSlots.length, variantStripCount(node));
    redo.push({
      op: "set",
      path: `nodes.${nodeId}.slots`,
      value: nextSlots,
      prev: structuredClone(node.slots),
    });
    redo.push({ op: "set", path: `nodes.${nodeId}.height`, value: height, prev: node.height });
    redo.push(...this.staleOps(nodeId, true));
    this.commit(
      createHistoryEntry({
        label: "删除槽",
        redo,
        selectAfterRedo: [nodeId],
        selectAfterUndo: [...this.selectedIds],
      }),
    );
    return true;
  }

  reorderSlots(nodeId: string, fromSlotId: string, toSlotId: string): boolean {
    if (this.project === null || fromSlotId === toSlotId) {
      return false;
    }
    const node = this.project.nodes[nodeId];
    if (node === undefined || node.slots === undefined) {
      return false;
    }
    const from = node.slots.find((item) => item.id === fromSlotId);
    const to = node.slots.find((item) => item.id === toSlotId);
    if (from === undefined || to === undefined || from.role !== to.role) {
      return false;
    }
    const nextSlots = node.slots.map((item) => {
      if (item.id === fromSlotId) {
        return { ...item, order: to.order };
      }
      if (item.id === toSlotId) {
        return { ...item, order: from.order };
      }
      return item;
    });
    const indexed = reindexSlots(nextSlots);
    this.commit(
      createHistoryEntry({
        label: "重排槽",
        redo: [
          {
            op: "set",
            path: `nodes.${nodeId}.slots`,
            value: indexed,
            prev: structuredClone(node.slots),
          },
          ...this.staleOps(nodeId, true),
        ],
        selectAfterRedo: [nodeId],
        selectAfterUndo: [...this.selectedIds],
      }),
    );
    return true;
  }

  selectActiveVariant(nodeId: string, variantId: string): boolean {
    if (this.project === null) {
      return false;
    }
    const node = this.project.nodes[nodeId];
    if (node === undefined) {
      return false;
    }
    const found = findVariant(node, variantId);
    if (found === null || !canExtractVariant(found.variant) && found.variant.phase !== "succeeded") {
      return false;
    }
    const variant = found.variant;
    if (variant.phase !== "succeeded") {
      return false;
    }
    if (node.activeVariantId === variantId && node.output === variant.output) {
      return true;
    }
    const heightOp = versionHeightOp(nodeId, node, found.versionId);
    const redo: Op[] = [
      {
        op: "set",
        path: `nodes.${nodeId}.activeVariantId`,
        value: variantId,
        prev: node.activeVariantId ?? null,
      },
      {
        op: "set",
        path: `nodes.${nodeId}.currentVersionId`,
        value: found.versionId,
        prev: node.currentVersionId ?? null,
      },
      {
        op: "set",
        path: `nodes.${nodeId}.output`,
        value: structuredClone(variant.output),
        prev: structuredClone(node.output ?? null),
      },
      {
        op: "set",
        path: `nodes.${nodeId}.outputText`,
        value: variant.text,
        prev: node.outputText ?? null,
      },
      {
        op: "set",
        path: `nodes.${nodeId}.outputRevision`,
        value: node.outputRevision + 1,
        prev: node.outputRevision,
      },
      ...(heightOp === null ? [] : [heightOp]),
      ...this.staleOps(nodeId, false),
    ];
    this.commit(
      createHistoryEntry({
        label: "切换变体",
        redo,
        selectAfterRedo: [nodeId],
        selectAfterUndo: [...this.selectedIds],
      }),
    );
    return true;
  }

  clickFailedVariant(nodeId: string, variantId: string): boolean {
    if (this.project === null) {
      return false;
    }
    const node = this.project.nodes[nodeId];
    if (node === undefined) {
      return false;
    }
    const found = findVariant(node, variantId);
    if (found === null || found.variant.phase !== "failed") {
      return false;
    }
    if (found.variant.output !== null) {
      return this.selectActiveVariant(nodeId, variantId);
    }
    const heightOp = versionHeightOp(nodeId, node, found.versionId);
    const redo: Op[] = [
      {
        op: "set",
        path: `nodes.${nodeId}.activeVariantId`,
        value: variantId,
        prev: node.activeVariantId ?? null,
      },
      {
        op: "set",
        path: `nodes.${nodeId}.currentVersionId`,
        value: found.versionId,
        prev: node.currentVersionId ?? null,
      },
      {
        op: "set",
        path: `nodes.${nodeId}.output`,
        value: null,
        prev: structuredClone(node.output ?? null),
      },
      {
        op: "set",
        path: `nodes.${nodeId}.outputText`,
        value: null,
        prev: node.outputText ?? null,
      },
      {
        op: "set",
        path: `nodes.${nodeId}.outputRevision`,
        value: node.outputRevision + 1,
        prev: node.outputRevision,
      },
      ...(heightOp === null ? [] : [heightOp]),
      ...this.staleOps(nodeId, false),
    ];
    this.commit(
      createHistoryEntry({
        label: "查看失败变体",
        redo,
        selectAfterRedo: [nodeId],
        selectAfterUndo: [...this.selectedIds],
      }),
    );
    return true;
  }

  clickVariant(nodeId: string, variantId: string): boolean {
    if (this.project === null) {
      return false;
    }
    const node = this.project.nodes[nodeId];
    if (node === undefined) {
      return false;
    }
    const found = findVariant(node, variantId);
    if (found === null) {
      return false;
    }
    if (found.variant.phase === "queued" || found.variant.phase === "running") {
      this.select([nodeId]);
      return true;
    }
    if (found.variant.phase === "failed" && found.variant.output == null) {
      return this.clickFailedVariant(nodeId, variantId);
    }
    if (found.variant.phase === "succeeded") {
      return this.selectActiveVariant(nodeId, variantId);
    }
    return false;
  }

  /**
   * 切旧版是内容脏，不新开版本，不写 versions / phase，不发运行。
   * 排队或运行中 currentVersionId 仍以服务器为准，这里不改。
   */
  selectVersion(nodeId: string, versionId: string): boolean {
    if (this.project === null) {
      return false;
    }
    const node = this.project.nodes[nodeId];
    if (node === undefined || node.kind !== "generation") {
      return false;
    }
    if (node.phase === "queued" || node.phase === "running") {
      return false;
    }
    const version = (node.versions ?? []).find((item) => item.id === versionId);
    if (version === undefined) {
      return false;
    }
    const chosen = chosenVariant(version);
    const nextOutput = chosen?.output ?? null;
    const nextText = chosen?.text ?? null;
    const nextActive = chosen?.id ?? null;
    if (
      node.currentVersionId === versionId &&
      (node.activeVariantId ?? null) === nextActive &&
      JSON.stringify(node.output ?? null) === JSON.stringify(nextOutput) &&
      (node.outputText ?? null) === nextText
    ) {
      return true;
    }
    const outputChanged =
      JSON.stringify(node.output ?? null) !== JSON.stringify(nextOutput) ||
      (node.outputText ?? null) !== nextText;
    const heightOp = versionHeightOp(nodeId, node, versionId);
    const freshnessOp =
      this.project === null ? null : versionFreshnessOp(nodeId, node, versionId, this.project);
    const redo: Op[] = [
      {
        op: "set",
        path: `nodes.${nodeId}.currentVersionId`,
        value: versionId,
        prev: node.currentVersionId ?? null,
      },
      {
        op: "set",
        path: `nodes.${nodeId}.activeVariantId`,
        value: nextActive,
        prev: node.activeVariantId ?? null,
      },
      {
        op: "set",
        path: `nodes.${nodeId}.output`,
        value: structuredClone(nextOutput),
        prev: structuredClone(node.output ?? null),
      },
      {
        op: "set",
        path: `nodes.${nodeId}.outputText`,
        value: nextText,
        prev: node.outputText ?? null,
      },
      ...(outputChanged
        ? [
            {
              op: "set" as const,
              path: `nodes.${nodeId}.outputRevision`,
              value: node.outputRevision + 1,
              prev: node.outputRevision,
            },
          ]
        : []),
      ...(heightOp === null ? [] : [heightOp]),
      ...(freshnessOp === null ? [] : [freshnessOp]),
      ...this.staleOps(nodeId, false),
    ];
    this.commit(
      createHistoryEntry({
        label: "切换版本",
        redo,
        selectAfterRedo: [nodeId],
        selectAfterUndo: [...this.selectedIds],
      }),
    );
    return true;
  }

  extractVariantToBlank(
    nodeId: string,
    variantId: string,
    world: { x: number; y: number },
  ): string | null {
    if (this.project === null) {
      return null;
    }
    const node = this.project.nodes[nodeId];
    if (node === undefined) {
      return null;
    }
    const found = findVariant(node, variantId);
    if (found === null || !canExtractVariant(found.variant) || found.variant.output == null) {
      return null;
    }
    const newId = this.idFactory();
    const detached = createDetachedMediaNode({
      id: newId,
      title: node.title,
      x: world.x - DEFAULT_NODE_SIZE.image.width / 2,
      y: world.y - DEFAULT_NODE_SIZE.image.minHeight / 2,
      z: maxNodeZ(this.project.nodes) + 1,
      now: this.now(),
      media: found.variant.output,
      provenance: { sourceNodeId: nodeId, versionId: found.versionId, variantId },
    });
    this.commit(
      createHistoryEntry({
        label: "抽出变体",
        redo: [{ op: "put-node", node: detached }],
        selectAfterRedo: [newId],
        selectAfterUndo: [...this.selectedIds],
      }),
    );
    return newId;
  }

  extractVariantToSlot(
    nodeId: string,
    variantId: string,
    targetNodeId: string,
    targetSlotId: string,
    world: { x: number; y: number },
  ): string | null {
    if (this.project === null) {
      return null;
    }
    const source = this.project.nodes[nodeId];
    const target = this.project.nodes[targetNodeId];
    if (source === undefined || target === undefined || target.slots === undefined) {
      return null;
    }
    const found = findVariant(source, variantId);
    if (found === null || !canExtractVariant(found.variant) || found.variant.output == null) {
      return null;
    }
    const slot = target.slots.find((item) => item.id === targetSlotId);
    if (slot === undefined) {
      return null;
    }
    const kind = found.variant.output.kind;
    if (!ROLE_ACCEPTS[slot.role].includes(kind)) {
      return null;
    }
    const newId = this.extractVariantToBlank(nodeId, variantId, world);
    if (newId === null) {
      return null;
    }
    const connected = this.connectToSlot(newId, targetNodeId, targetSlotId);
    if (!connected.ok) {
      this.undo();
      return null;
    }
    return newId;
  }

  injectSucceededVariants(nodeId: string, outputs: MediaRef[]): boolean {
    if (this.project === null || outputs.length === 0) {
      return false;
    }
    const node = this.project.nodes[nodeId];
    if (node === undefined || node.kind !== "generation") {
      return false;
    }
    const iso = this.now().toISOString();
    const versionId = this.idFactory();
    const variants: Variant[] = outputs.map((media, index) => ({
      id: this.idFactory(),
      index,
      phase: "succeeded",
      seedUsed: index + 1,
      output: structuredClone(media),
      text: null,
      error: null,
      createdAt: iso,
    }));
    const last = variants[variants.length - 1];
    if (last === undefined) {
      return false;
    }
    const nextNode: ProjectNode = {
      ...structuredClone(node),
      versions: [
        ...(node.versions ?? []),
        {
          id: versionId,
          createdAt: iso,
          fingerprint: "",
          recipeId: node.recipeId ?? "",
          recipeVersion: node.recipeVersion ?? 1,
          paramSnapshot: structuredClone(node.params ?? {}),
          variantCountRequested: variants.length,
          variants,
        },
      ],
      currentVersionId: versionId,
      activeVariantId: last.id,
      output: structuredClone(last.output),
      phase: "succeeded",
      freshness: "fresh",
      variantCount: variants.length,
      height: generationNodeHeight(node.slots?.length ?? 0, variants.length),
      outputRevision: node.outputRevision + 1,
      updatedAt: iso,
    };
    const nodesForFp = { ...this.project.nodes, [nodeId]: nextNode };
    const fp = fingerprintNode(nextNode, nodesForFp, this.project.edges);
    const version = nextNode.versions?.[nextNode.versions.length - 1];
    if (version !== undefined) {
      version.fingerprint = fp;
    }
    nextNode.lastSuccessFingerprint = fp;
    nextNode.lastAttemptFingerprint = fp;
    const redo: Op[] = [
      {
        op: "set",
        path: `nodes.${nodeId}.versions`,
        value: structuredClone(nextNode.versions),
        prev: structuredClone(node.versions ?? []),
      },
      {
        op: "set",
        path: `nodes.${nodeId}.currentVersionId`,
        value: versionId,
        prev: node.currentVersionId ?? null,
      },
      {
        op: "set",
        path: `nodes.${nodeId}.activeVariantId`,
        value: last.id,
        prev: node.activeVariantId ?? null,
      },
      {
        op: "set",
        path: `nodes.${nodeId}.output`,
        value: structuredClone(last.output),
        prev: structuredClone(node.output ?? null),
      },
      {
        op: "set",
        path: `nodes.${nodeId}.phase`,
        value: "succeeded",
        prev: node.phase ?? "idle",
      },
      {
        op: "set",
        path: `nodes.${nodeId}.freshness`,
        value: "fresh",
        prev: node.freshness ?? "fresh",
      },
      {
        op: "set",
        path: `nodes.${nodeId}.lastSuccessFingerprint`,
        value: fp,
        prev: node.lastSuccessFingerprint ?? null,
      },
      {
        op: "set",
        path: `nodes.${nodeId}.lastAttemptFingerprint`,
        value: fp,
        prev: node.lastAttemptFingerprint ?? null,
      },
      {
        op: "set",
        path: `nodes.${nodeId}.variantCount`,
        value: variants.length,
        prev: node.variantCount ?? 1,
      },
      {
        op: "set",
        path: `nodes.${nodeId}.height`,
        value: nextNode.height,
        prev: node.height,
      },
      {
        op: "set",
        path: `nodes.${nodeId}.outputRevision`,
        value: nextNode.outputRevision,
        prev: node.outputRevision,
      },
      {
        op: "set",
        path: `nodes.${nodeId}.updatedAt`,
        value: iso,
        prev: node.updatedAt,
      },
    ];
    this.commit(
      createHistoryEntry({
        label: "注入假变体",
        redo,
        selectAfterRedo: [nodeId],
        selectAfterUndo: [...this.selectedIds],
      }),
    );
    return true;
  }

  addableRoles(nodeId: string): SlotRole[] {
    const node = this.project?.nodes[nodeId];
    if (node === undefined) {
      return [];
    }
    return addableRolesForNode(node);
  }

  setLastConnectMessage(message: string | null): void {
    this.lastConnectMessage = message;
    this.emit();
  }

  emitRunThisNode(nodeId: string, confirmed = false): RunEmitResult {
    if (this.project === null) {
      return { ok: false, message: USER_FACING.runDisabledOffline };
    }
    const node = this.project.nodes[nodeId];
    if (node === undefined || node.kind !== "generation") {
      return { ok: false, message: USER_FACING.runDisabledText };
    }
    const badge = generationBadge(node);
    const force = nodeRunForce(badge, confirmed);
    if (force.needsConfirm) {
      return {
        ok: false,
        message: force.confirmMessage ?? USER_FACING.runFreshConfirm,
        needsConfirm: true,
        confirmMessage: force.confirmMessage,
      };
    }
    return this.emitRunRequest({ type: "node", nodeId }, force.force);
  }

  emitRunDownstream(nodeId: string): RunEmitResult {
    return this.emitRunRequest({ type: "downstream", nodeId }, false);
  }

  emitRunSelection(confirmed = false): RunEmitResult {
    if (this.project === null) {
      return { ok: false, message: USER_FACING.runDisabledOffline };
    }
    const selected = expandSelectionToNodes(
      this.project.nodes,
      this.project.groups,
      [...this.selectedIds],
    )
      .map((id) => this.project?.nodes[id])
      .filter((node): node is ProjectNode => node !== undefined);
    if (!selectionHasGeneration(selected)) {
      return { ok: false, message: USER_FACING.runDisabledText };
    }
    const hasFreshSuccess = selected.some(
      (node) => node.kind === "generation" && generationBadge(node) === "succeeded",
    );
    const force = selectionRunForce(hasFreshSuccess, confirmed);
    if (force.needsConfirm) {
      return {
        ok: false,
        message: force.confirmMessage ?? USER_FACING.runSelectionConfirm,
        needsConfirm: true,
        confirmMessage: force.confirmMessage,
      };
    }
    return this.emitRunRequest(
      { type: "selection", nodeIds: selected.filter((node) => node.kind === "generation").map((node) => node.id) },
      force.force,
    );
  }

  undo(): boolean {
    this.gestureActive = false;
    const entry = this.history.undo();
    if (entry === null || this.project === null) {
      return false;
    }
    this.project = applyOps(this.project, entry.undo);
    this.project = { ...this.project, updatedAt: this.now().toISOString() };
    this.applySelectList(entry.selectAfterUndo);
    this.rebuildSpatial();
    this.markContentChanged();
    this.emit();
    return true;
  }

  redo(): boolean {
    this.gestureActive = false;
    const entry = this.history.redo();
    if (entry === null || this.project === null) {
      return false;
    }
    this.project = applyOps(this.project, entry.redo);
    this.project = { ...this.project, updatedAt: this.now().toISOString() };
    this.applySelectList(entry.selectAfterRedo);
    this.rebuildSpatial();
    this.markContentChanged();
    this.emit();
    return true;
  }

  querySpatial(rect: WorldRect): string[] {
    return this.spatial.query(rect);
  }

  nodeMap(): Record<string, ProjectNode> {
    return this.project?.nodes ?? {};
  }

  edgeMap(): Record<string, ProjectEdge> {
    return this.project?.edges ?? {};
  }

  groupMap(): Record<string, ProjectGroup> {
    return this.project?.groups ?? {};
  }

  rebuildSpatial(): void {
    this.spatial.clear();
    if (this.project === null) {
      return;
    }
    for (const node of Object.values(this.project.nodes)) {
      this.spatial.insert(node.id, {
        x: node.x,
        y: node.y,
        width: node.width,
        height: node.height,
      });
    }
  }

  markContentChanged(): void {
    this.localUnsaved = true;
    this.pendingWorkingCopy = true;
    this.syncGen += 1;
  }

  private rejectConnect(message: string): ConnectResult {
    this.lastConnectMessage = message;
    this.emit();
    return { ok: false, message };
  }

  private emitRunRequest(
    scope: RunRequest["scope"],
    force: boolean,
  ): RunEmitResult {
    if (this.project === null) {
      return { ok: false, message: USER_FACING.runDisabledOffline };
    }
    const request = buildRunRequest({
      projectId: this.project.projectId,
      clientRequestId: this.idFactory(),
      scope,
      force,
    });
    this.lastEmittedRunRequest = request;
    this.emit();
    return { ok: true, request };
  }

  private staleOps(fromNodeId: string, includeOrigin: boolean): Op[] {
    if (this.project === null) {
      return [];
    }
    const nodes: Record<string, ProjectNode> = { ...this.project.nodes };
    applyStaleFrom(nodes, this.project.edges, fromNodeId);
    if (includeOrigin) {
      const origin = nodes[fromNodeId];
      if (origin !== undefined && origin.kind === "generation") {
        nodes[fromNodeId] = markNodeStale(origin);
      }
    }
    const redo: Op[] = [];
    for (const [id, next] of Object.entries(nodes)) {
      const prev = this.project.nodes[id];
      if (prev === undefined) {
        continue;
      }
      if (prev.freshness !== next.freshness) {
        redo.push({
          op: "set",
          path: `nodes.${id}.freshness`,
          value: next.freshness,
          prev: prev.freshness ?? "fresh",
        });
      }
      if (prev.inputsChangedWhileRunning !== next.inputsChangedWhileRunning) {
        redo.push({
          op: "set",
          path: `nodes.${id}.inputsChangedWhileRunning`,
          value: next.inputsChangedWhileRunning,
          prev: prev.inputsChangedWhileRunning ?? false,
        });
      }
    }
    return redo;
  }

  private pasteFrom(source: {
    nodes: Record<string, ProjectNode>;
    edges: Record<string, ProjectEdge>;
    groups: Record<string, ProjectGroup>;
    selectedIds: string[];
  }): string[] {
    if (this.project === null) {
      return [];
    }
    const cloned = cloneSubgraphForPaste({
      nodes: source.nodes,
      edges: source.edges,
      groups: source.groups,
      selectedIds: source.selectedIds,
      idFactory: this.idFactory,
      offset: { x: COPY_OFFSET, y: COPY_OFFSET },
    });
    if (cloned.newNodeIds.length === 0) {
      return [];
    }
    const redo: Op[] = [];
    for (const node of Object.values(cloned.nodes)) {
      redo.push({ op: "put-node", node });
    }
    for (const edge of Object.values(cloned.edges)) {
      redo.push({ op: "put-edge", edge });
    }
    for (const group of Object.values(cloned.groups)) {
      redo.push({ op: "put-group", group });
    }
    this.commit(
      createHistoryEntry({
        label: "粘贴",
        redo,
        selectAfterRedo: cloned.newNodeIds,
        selectAfterUndo: [...this.selectedIds],
      }),
    );
    return cloned.newNodeIds;
  }

  private commit(entry: HistoryEntry): void {
    if (this.project === null) {
      return;
    }
    this.history.push(entry);
    this.project = applyOps(this.project, entry.redo);
    this.project = { ...this.project, updatedAt: this.now().toISOString() };
    this.applySelectList(entry.selectAfterRedo);
    this.rebuildSpatial();
    this.markContentChanged();
    this.emit();
  }

  private applySelectList(ids: readonly string[]): void {
    this.selectedIds = new Set(ids);
    this.selectedEdgeIds = new Set();
  }

  private flushPendingPatches(): void {
    if (this.pendingPatches.length === 0) {
      return;
    }
    const queued = this.pendingPatches;
    this.pendingPatches = [];
    for (const item of queued) {
      this.applyNodePatchNow(item.nodeId, item.patch, item.meta);
    }
  }

  private applyNodePatchNow(
    nodeId: string,
    patch: Partial<ProjectNode>,
    meta?: { contentRevision?: number; executionRevision?: number },
  ): void {
    if (this.project === null) {
      return;
    }
    const prev = this.project.nodes[nodeId];
    if (prev === undefined) {
      return;
    }
    const next: ProjectNode = { ...prev };
    for (const key of Object.keys(patch) as Array<keyof ProjectNode>) {
      if (PATCH_IGNORE_KEYS.has(key as string)) {
        continue;
      }
      const value = patch[key];
      if (value === undefined && !Object.hasOwn(patch, key)) {
        continue;
      }
      (next as unknown as Record<string, unknown>)[key as string] = structuredClone(value);
    }
    if (meta?.executionRevision !== undefined) {
      next.executionRevision = meta.executionRevision;
    }
    if (next.kind === "generation") {
      next.height = generationHeightFor(next);
    }
    this.project.nodes[nodeId] = next;
    if (meta?.contentRevision !== undefined) {
      this.project.contentRevision = meta.contentRevision;
    }
    const landing =
      Object.hasOwn(patch, "versions") || Object.hasOwn(patch, "output");
    this.rebuildSpatial();
    if (landing) {
      this.markContentChanged();
    }
    this.emit();
  }

  private buildSnapshot(): EditorSnapshot {
    const project = this.project;
    const nodes = project === null ? [] : Object.values(project.nodes);
    nodes.sort((a, b) => a.z - b.z || a.id.localeCompare(b.id));
    const unsaved =
      this.localUnsaved || (project !== null && isContentUnsaved(project));
    const selectedIds = [...this.selectedIds];
    const expanded =
      project === null
        ? selectedIds
        : expandSelectionToNodes(project.nodes, project.groups, selectedIds);
    return {
      project,
      camera: this.camera,
      unsaved,
      workingCopyBlocked: this.workingCopyBlocked,
      needsWorkingCopySync: this.pendingWorkingCopy,
      empty: project !== null && isProjectEmpty(project),
      nodes,
      selectedIds,
      selectedEdgeIds: [...this.selectedEdgeIds],
      selectedCount: expanded.length,
      gestureActive: this.gestureActive,
      gestureKind: this.gestureKind,
      canUndo: this.history.canUndo(),
      canRedo: this.history.canRedo(),
      lastEmittedRunRequest: this.lastEmittedRunRequest,
      lastConnectMessage: this.lastConnectMessage,
    };
  }

  private emit(): void {
    this.snapshot = this.buildSnapshot();
    for (const listener of this.listeners) {
      listener();
    }
  }
}

function setsEqual(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size !== b.size) {
    return false;
  }
  for (const value of a) {
    if (!b.has(value)) {
      return false;
    }
  }
  return true;
}

function copyNodeField(target: ProjectNode, source: ProjectNode, key: keyof ProjectNode): void {
  if (!Object.hasOwn(source, key)) {
    return;
  }
  const value = source[key];
  (target as unknown as Record<string, unknown>)[key as string] = structuredClone(value);
}
