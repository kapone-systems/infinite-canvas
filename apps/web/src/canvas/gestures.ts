import type { Camera, ConnectTarget, ProjectEdge, ProjectGroup, ProjectNode } from "@canvas/schema";
import {
  camerasEqual,
  panByScreenDelta,
  screenToWorld,
  zoomAtPointer,
  type Point,
  type Size,
} from "./coords.ts";
import type { EditorStore } from "./EditorStore.ts";
import { expandSelectionToNodes, selectionContainsNode, canExtractVariant, findVariant } from "./document.ts";
import {
  HEADER,
  CONNECT_BOUNCE_MS,
  EXTRACT_GHOST_SCALE,
  EXTRACT_LEAVE_PX,
  POINTER_THRESHOLD_PX,
  VIEWPORT_PUT_IDLE_MS,
} from "./metrics.ts";
import {
  hitTest,
  marqueeHitsNode,
  marqueeModeFromAlt,
  outputPortWorld,
  slotPortWorld,
  type Hit,
} from "./hitTest.ts";
import { nodeTransform } from "./coords.ts";
import type { LiveDelta } from "./EdgeCanvas.ts";

export function exceededThreshold(dx: number, dy: number, threshold = POINTER_THRESHOLD_PX): boolean {
  return dx * dx + dy * dy >= threshold * threshold;
}

export function wheelShouldZoom(input: {
  composing: boolean;
  editable: boolean;
  viewerOpen: boolean;
}): boolean {
  return !input.viewerOpen && !input.composing && !input.editable;
}

export function applyWheelZoom(
  camera: Camera,
  pointer: Point,
  viewport: Size,
  deltaY: number,
): Camera {
  return zoomAtPointer(camera, pointer, viewport, deltaY);
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  return target.closest("textarea, input, button, a, select, [contenteditable='true']") !== null;
}

export type GestureKind = "idle" | "pending" | "pan" | "move" | "marquee" | "connect" | "extract" | "reorder-slot";

export type LivePaint = {
  camera: Camera;
  liveDelta: LiveDelta | null;
  straight: boolean;
  connectLine: { from: Point; to: Point } | null;
};

export type GestureView = {
  getSize: () => Size;
  applyLive: (paint: LivePaint) => void;
  applyMarquee: (rect: { x: number; y: number; width: number; height: number } | null) => void;
  classSelect: (ids: ReadonlySet<string>) => void;
  host: HTMLElement;
};

export type GestureSessionOptions = {
  store: EditorStore;
  view: GestureView;
  getMountedIds: () => ReadonlySet<string>;
  isTextEditing: () => boolean;
  isComposing: () => boolean;
  viewerOpen: () => boolean;
  onStartTextEdit: (nodeId: string) => void;
  commitCamera: (camera: Camera) => void;
};

export type GestureSession = {
  detach: () => void;
  /** 夹具 / Ctrl+0 等外部改相机时写入 live，并取消未提交的滚轮提交。手势进行中忽略。 */
  syncCamera: (camera: Camera) => void;
  getLiveCamera: () => Camera;
  isBusy: () => boolean;
};

/** 手势进行中不拿 store 相机盖掉 live，以免夹具加载被未完成的平移/滚轮写回。 */
export function shouldAdoptStoreCamera(gestureActive: boolean): boolean {
  return !gestureActive;
}

export type ExtractCommit =
  | { action: "none" }
  | { action: "blank" }
  | { action: "slot"; targetNodeId: string; targetSlotId: string };

/**
 * 抽出松手：拖回源变体条不 put-node；落到兼容槽接线；落到空白才 +1。
 */
export function decideExtractCommit(input: {
  dropOnSourceStrip: boolean;
  hitKind: string;
  hitNodeId?: string | null;
  hitSlotId?: string | null;
}): ExtractCommit {
  if (input.dropOnSourceStrip) {
    return { action: "none" };
  }
  if (
    input.hitKind === "slot" &&
    input.hitNodeId != null &&
    input.hitNodeId !== "" &&
    input.hitSlotId != null &&
    input.hitSlotId !== ""
  ) {
    return { action: "slot", targetNodeId: input.hitNodeId, targetSlotId: input.hitSlotId };
  }
  if (input.hitKind === "empty") {
    return { action: "blank" };
  }
  return { action: "none" };
}

type Pending = {
  kind: "pending" | "pan" | "move" | "marquee" | "connect" | "extract" | "reorder-slot";
  pointerId: number;
  startScreen: Point;
  lastScreen: Point;
  startWorld: Point;
  hit: Hit;
  moveIds: string[];
  origins: Map<string, { x: number; y: number }>;
  alt: boolean;
  shift: boolean;
  connectFrom: { nodeId: string; slotId?: string; output: boolean; slotOrder?: number } | null;
  extractFrom: {
    nodeId: string;
    variantId: string;
    canExtract: boolean;
    strip: HTMLElement | null;
    scrolled: boolean;
  } | null;
  reorderFrom: { nodeId: string; slotId: string } | null;
};

export function attachCanvasGestures(options: GestureSessionOptions): GestureSession {
  const { store, view } = options;
  const el = view.host;
  let spaceDown = false;
  let active: Pending | null = null;
  let liveCamera: Camera = store.getSnapshot().camera;
  let wheelTimer: number | null = null;
  let raf = 0;
  let pendingPoint: Point | null = null;
  let bounceTimer: number | null = null;
  let ghostEl: HTMLElement | null = null;

  const cameraNow = (): Camera => liveCamera;

  const paint = (input: Partial<LivePaint> & { camera?: Camera }): void => {
    const camera = input.camera ?? liveCamera;
    liveCamera = camera;
    view.applyLive({
      camera,
      liveDelta: input.liveDelta ?? null,
      straight: input.straight === true,
      connectLine: input.connectLine ?? null,
    });
  };

  const commitCameraIfChanged = (): void => {
    const current = store.getSnapshot().camera;
    if (!camerasEqual(current, liveCamera)) {
      options.commitCamera(liveCamera);
    }
  };

  const buildHit = (screen: Point, connecting: boolean): Hit => {
    const size = view.getSize();
    const camera = cameraNow();
    const world = screenToWorld(screen, camera, size);
    const nodes = Object.values(store.nodeMap());
    const edges = Object.values(store.edgeMap()).map((edge) => edgeToHit(edge, store.nodeMap()));
    const groups = Object.values(store.groupMap()).map((group) => groupToHit(group, store.nodeMap()));
    const slots = [];
    const outputs = [];
    for (const node of nodes) {
      outputs.push({ nodeId: node.id, ...outputPortWorld(node) });
      if (node.slots === undefined) {
        continue;
      }
      for (const slot of node.slots) {
        const pt = slotPortWorld(node, slot.order);
        slots.push({
          nodeId: node.id,
          slotId: slot.id,
          x: node.x,
          y: pt.y - 18,
          width: node.width,
          height: 36,
          role: slot.role,
          order: slot.order,
        });
      }
    }
    return hitTest({
      screen,
      world,
      camera,
      viewport: size,
      connecting,
      mountedIds: options.getMountedIds(),
      nodes,
      edges,
      groups,
      slots,
      outputs,
      selectedEdgeIds: new Set(store.getSnapshot().selectedEdgeIds),
    });
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.code !== "Space" && event.key !== " ") {
      return;
    }
    if (isEditableTarget(event.target) || options.isTextEditing()) {
      return;
    }
    if (event.repeat) {
      event.preventDefault();
      return;
    }
    spaceDown = true;
    event.preventDefault();
    el.classList.add("is-pan");
  };

  const onKeyUp = (event: KeyboardEvent): void => {
    if (event.code !== "Space" && event.key !== " ") {
      return;
    }
    spaceDown = false;
    if (active === null || active.kind !== "pan") {
      el.classList.remove("is-pan");
    }
  };

  const beginPan = (event: PointerEvent, screen: Point): void => {
    event.preventDefault();
    store.setGestureActive(true, "pan");
    active = {
      kind: "pan",
      pointerId: event.pointerId,
      startScreen: screen,
      lastScreen: screen,
      startWorld: screenToWorld(screen, cameraNow(), view.getSize()),
      hit: { kind: "empty" },
      moveIds: [],
      origins: new Map(),
      alt: event.altKey,
      shift: event.shiftKey,
      connectFrom: null,
      extractFrom: null,
      reorderFrom: null,
    };
    liveCamera = store.getSnapshot().camera;
    el.classList.add("is-panning", "is-pan");
    el.setPointerCapture(event.pointerId);
  };

  const onPointerDown = (event: PointerEvent): void => {
    if (active !== null) {
      return;
    }
    const rect = el.getBoundingClientRect();
    const screen = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    const middle = event.button === 1;
    const spacePan = event.button === 0 && spaceDown;
    if (middle || spacePan) {
      if (!middle && isEditableTarget(event.target)) {
        return;
      }
      beginPan(event, screen);
      return;
    }
    if (event.button !== 0) {
      return;
    }
    const targetEl = event.target instanceof Element ? event.target : null;
    if (targetEl?.closest("[data-add-slot]") !== null) {
      return;
    }
    if (isEditableTarget(event.target) || options.isTextEditing()) {
      return;
    }
    liveCamera = store.getSnapshot().camera;

    const variantEl = targetEl?.closest("[data-variant-id]");
    if (variantEl instanceof HTMLElement) {
      const nodeEl = variantEl.closest("[data-node-id]");
      const nodeId = nodeEl?.getAttribute("data-node-id");
      const variantId = variantEl.getAttribute("data-variant-id");
      if (nodeId !== null && nodeId !== undefined && variantId !== null) {
        const node = store.nodeMap()[nodeId];
        const found = node !== undefined ? findVariant(node, variantId) : null;
        const canExtract = found !== null && canExtractVariant(found.variant);
        event.preventDefault();
        store.setGestureActive(true, "pending");
        active = {
          kind: "pending",
          pointerId: event.pointerId,
          startScreen: screen,
          lastScreen: screen,
          startWorld: screenToWorld(screen, cameraNow(), view.getSize()),
          hit: { kind: "near-node", nodeId },
          moveIds: [],
          origins: new Map(),
          alt: event.altKey,
          shift: event.shiftKey,
          connectFrom: null,
          extractFrom: {
            nodeId,
            variantId,
            canExtract,
            strip: variantEl.closest(".variant-strip"),
            scrolled: false,
          },
          reorderFrom: null,
        };
        el.setPointerCapture(event.pointerId);
        return;
      }
    }

    const handleEl = targetEl?.closest("[data-slot-handle]");
    if (handleEl instanceof HTMLElement) {
      const nodeEl = handleEl.closest("[data-node-id]");
      const nodeId = nodeEl?.getAttribute("data-node-id");
      const slotId = handleEl.getAttribute("data-slot-handle") ?? handleEl.getAttribute("data-slot-id");
      const coveredBy = buildHit(screen, false);
      const coveredId =
        coveredBy.kind === "near-node" ||
        coveredBy.kind === "far-block" ||
        coveredBy.kind === "slot" ||
        coveredBy.kind === "slot-gap" ||
        coveredBy.kind === "output"
          ? coveredBy.nodeId
          : null;
      if (nodeId !== null && nodeId !== undefined && slotId !== null && (coveredId === null || coveredId === nodeId)) {
        event.preventDefault();
        store.setGestureActive(true, "pending");
        active = {
          kind: "pending",
          pointerId: event.pointerId,
          startScreen: screen,
          lastScreen: screen,
          startWorld: screenToWorld(screen, cameraNow(), view.getSize()),
          hit: { kind: "slot", nodeId, slotId },
          moveIds: [],
          origins: new Map(),
          alt: event.altKey,
          shift: event.shiftKey,
          connectFrom: null,
          extractFrom: null,
          reorderFrom: { nodeId, slotId },
        };
        el.setPointerCapture(event.pointerId);
        return;
      }
    }

    const hit = buildHit(screen, false);
    if (event.detail >= 2 && (hit.kind === "near-node" || hit.kind === "far-block")) {
      const node = store.nodeMap()[hit.nodeId];
      if (node?.kind === "text") {
        options.onStartTextEdit(node.id);
        event.preventDefault();
        return;
      }
    }

    if (hit.kind === "output" || hit.kind === "slot") {
      event.preventDefault();
      store.setGestureActive(true, "connect");
      const fromNode = store.nodeMap()[hit.nodeId];
      const slotOrder =
        hit.kind === "slot"
          ? (fromNode?.slots ?? []).find((item) => item.id === hit.slotId)?.order ?? 0
          : 0;
      active = {
        kind: "connect",
        pointerId: event.pointerId,
        startScreen: screen,
        lastScreen: screen,
        startWorld: screenToWorld(screen, cameraNow(), view.getSize()),
        hit,
        moveIds: [],
        origins: new Map(),
        alt: event.altKey,
        shift: event.shiftKey,
        connectFrom:
          hit.kind === "output"
            ? { nodeId: hit.nodeId, output: true }
            : { nodeId: hit.nodeId, slotId: hit.slotId, output: false, slotOrder },
        extractFrom: null,
        reorderFrom: null,
      };
      el.setPointerCapture(event.pointerId);
      return;
    }

    if (hit.kind === "near-node" || hit.kind === "far-block" || hit.kind === "group") {
      event.preventDefault();
      const snap = store.getSnapshot();
      if (hit.kind === "group") {
        if (!event.shiftKey) {
          store.select([hit.groupId]);
        }
      } else if (event.shiftKey) {
        store.toggleSelect(hit.nodeId);
      } else if (!selectionContainsNode(store.nodeMap(), store.groupMap(), snap.selectedIds, hit.nodeId)) {
        store.select([hit.nodeId]);
      }
      const selected = new Set(store.getSnapshot().selectedIds);
      view.classSelect(selected);
      const node = hit.kind === "group" ? undefined : store.nodeMap()[hit.nodeId];
      const inHeader =
        node !== undefined &&
        screenToWorld(screen, cameraNow(), view.getSize()).y < node.y + HEADER;
      const textPreview =
        node?.kind === "text" && hit.kind === "near-node" && !inHeader;
      const moveIds = textPreview
        ? []
        : expandSelectionToNodes(store.nodeMap(), store.groupMap(), [...store.getSnapshot().selectedIds]);
      const origins = new Map<string, { x: number; y: number }>();
      for (const id of moveIds) {
        const n = store.nodeMap()[id];
        if (n !== undefined) {
          origins.set(id, { x: n.x, y: n.y });
        }
      }
      store.setGestureActive(true, "pending");
      active = {
        kind: "pending",
        pointerId: event.pointerId,
        startScreen: screen,
        lastScreen: screen,
        startWorld: screenToWorld(screen, cameraNow(), view.getSize()),
        hit,
        moveIds,
        origins,
        alt: event.altKey,
        shift: event.shiftKey,
        connectFrom: null,
        extractFrom: null,
        reorderFrom: null,
      };
      el.setPointerCapture(event.pointerId);
      paint({ camera: liveCamera, straight: true, liveDelta: null });
      return;
    }

    event.preventDefault();
    store.setGestureActive(true, "pending");
    active = {
      kind: "pending",
      pointerId: event.pointerId,
      startScreen: screen,
      lastScreen: screen,
      startWorld: screenToWorld(screen, cameraNow(), view.getSize()),
      hit,
      moveIds: [],
      origins: new Map(),
      alt: event.altKey,
      shift: event.shiftKey,
      connectFrom: null,
      extractFrom: null,
      reorderFrom: null,
    };
    el.setPointerCapture(event.pointerId);
  };

  const flushMove = (): void => {
    raf = 0;
    if (active === null || pendingPoint === null) {
      return;
    }
    const point = pendingPoint;
    pendingPoint = null;
    const dx = point.x - active.lastScreen.x;
    const dy = point.y - active.lastScreen.y;
    active.lastScreen = point;
    if (active.kind === "pan") {
      paint({ camera: panByScreenDelta(liveCamera, dx, dy), straight: true });
      return;
    }
    if (active.kind === "move") {
      const worldNow = screenToWorld(point, cameraNow(), view.getSize());
      const liveDx = worldNow.x - active.startWorld.x;
      const liveDy = worldNow.y - active.startWorld.y;
      applyLiveNodeTransforms(view.host, active.origins, liveDx, liveDy);
      paint({
        camera: liveCamera,
        straight: true,
        liveDelta: { ids: new Set(active.moveIds), dx: liveDx, dy: liveDy },
      });
      return;
    }
    if (active.kind === "marquee") {
      const x = Math.min(active.startScreen.x, point.x);
      const y = Math.min(active.startScreen.y, point.y);
      const width = Math.abs(point.x - active.startScreen.x);
      const height = Math.abs(point.y - active.startScreen.y);
      view.applyMarquee({ x, y, width, height });
      return;
    }
    if (active.kind === "connect" && active.connectFrom !== null) {
      const fromNode = store.nodeMap()[active.connectFrom.nodeId];
      if (fromNode === undefined) {
        return;
      }
      const from = active.connectFrom.output
        ? outputPortWorld(fromNode)
        : slotPortWorld(fromNode, active.connectFrom.slotOrder ?? 0);
      const to = screenToWorld(point, cameraNow(), view.getSize());
      paint({ camera: liveCamera, straight: true, connectLine: { from, to } });
      return;
    }
    if (active.kind === "extract") {
      moveExtractGhost(ghostEl, point, el.getBoundingClientRect());
    }
  };

  const onPointerMove = (event: PointerEvent): void => {
    if (active === null || active.pointerId !== event.pointerId) {
      return;
    }
    const rect = el.getBoundingClientRect();
    const screen = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    if (active.kind === "pending") {
      const dx = screen.x - active.startScreen.x;
      const dy = screen.y - active.startScreen.y;
      if (!exceededThreshold(dx, dy)) {
        return;
      }
      if (active.extractFrom !== null) {
        const extract = active.extractFrom;
        const leave = extract.strip !== null && leftVariantStrip(extract.strip, event, EXTRACT_LEAVE_PX);
        const alt = event.altKey || active.alt;
        if (extract.canExtract && (alt || leave)) {
          active.kind = "extract";
          store.setGestureActive(true, "extract");
          ghostEl = showExtractGhost(el, event);
        } else if (
          extract.strip !== null &&
          Math.abs(dx) >= Math.abs(dy)
        ) {
          extract.strip.scrollLeft -= screen.x - active.lastScreen.x;
          extract.scrolled = true;
          active.lastScreen = screen;
          return;
        } else {
          return;
        }
      } else if (active.reorderFrom !== null) {
        active.kind = "reorder-slot";
        store.setGestureActive(true, "reorder-slot");
      } else if (active.moveIds.length > 0) {
        active.kind = "move";
        store.setGestureActive(true, "move");
      } else if (active.connectFrom !== null) {
        active.kind = "connect";
        store.setGestureActive(true, "connect");
      } else if (active.hit.kind === "empty" || active.hit.kind === "edge") {
        active.kind = "marquee";
        store.setGestureActive(true, "marquee");
      } else {
        return;
      }
    }
    pendingPoint = screen;
    if (raf === 0) {
      raf = window.requestAnimationFrame(flushMove);
    }
  };

  const endGesture = (event: PointerEvent): void => {
    if (active === null || active.pointerId !== event.pointerId) {
      return;
    }
    const current = active;
    active = null;
    pendingPoint = null;
    if (raf !== 0) {
      window.cancelAnimationFrame(raf);
      raf = 0;
    }
    el.classList.remove("is-panning");
    if (!spaceDown) {
      el.classList.remove("is-pan");
    }
    const rect = el.getBoundingClientRect();
    const screen = { x: event.clientX - rect.left, y: event.clientY - rect.top };

    if (current.kind === "pan") {
      store.setGestureActive(false);
      paint({ camera: liveCamera, straight: false });
      commitCameraIfChanged();
      return;
    }

    if (current.kind === "move") {
      const worldNow = screenToWorld(screen, cameraNow(), view.getSize());
      const dx = worldNow.x - current.startWorld.x;
      const dy = worldNow.y - current.startWorld.y;
      paint({ camera: liveCamera, straight: false, liveDelta: null });
      store.setGestureActive(false);
      if (dx !== 0 || dy !== 0) {
        store.moveNodes(current.moveIds, dx, dy);
      }
      return;
    }

    if (current.kind === "marquee") {
      const size = view.getSize();
      const a = screenToWorld(current.startScreen, cameraNow(), size);
      const b = screenToWorld(screen, cameraNow(), size);
      const marquee = {
        x: Math.min(a.x, b.x),
        y: Math.min(a.y, b.y),
        width: Math.abs(b.x - a.x),
        height: Math.abs(b.y - a.y),
      };
      const mode = marqueeModeFromAlt(current.alt);
      const ids: string[] = [];
      for (const node of Object.values(store.nodeMap())) {
        if (marqueeHitsNode(marquee, node, mode)) {
          ids.push(node.id);
        }
      }
      view.applyMarquee(null);
      store.setGestureActive(false);
      store.marqueeSelect(ids, current.shift);
      paint({ camera: liveCamera, straight: false });
      return;
    }

    if (current.kind === "connect" && current.connectFrom !== null) {
      const hit = buildHit(screen, true);
      store.setGestureActive(false);
      const fromNode = store.nodeMap()[current.connectFrom.nodeId];
      const fromPoint =
        fromNode === undefined
          ? screenToWorld(current.startScreen, cameraNow(), view.getSize())
          : current.connectFrom.output
            ? outputPortWorld(fromNode)
            : slotPortWorld(fromNode, current.connectFrom.slotOrder ?? 0);
      const toPoint = screenToWorld(screen, cameraNow(), view.getSize());
      let result: { ok: true; replace: boolean } | { ok: false; message: string };
      if (current.connectFrom.output) {
        if (hit.kind === "slot-gap") {
          const inserted = store.connectInsert(current.connectFrom.nodeId, hit.nodeId, hit.role, hit.insertOrder);
          result = inserted.ok ? inserted : store.connect(current.connectFrom.nodeId, connectTargetFromHit(hit));
        } else {
          result = store.connect(current.connectFrom.nodeId, connectTargetFromHit(hit));
        }
      } else if (hit.kind === "output" && current.connectFrom.slotId !== undefined) {
        result = store.connect(hit.nodeId, {
          type: "slot",
          nodeId: current.connectFrom.nodeId,
          slotId: current.connectFrom.slotId,
        });
      } else {
        result = store.connect(current.connectFrom.nodeId, connectTargetFromHit(hit));
      }
      if (result.ok) {
        paint({ camera: liveCamera, straight: false, connectLine: null });
        store.setLastConnectMessage(null);
        return;
      }
      startConnectBounce({
        from: fromPoint,
        to: toPoint,
        message: result.message,
        paint,
        store,
        getBounceTimer: () => bounceTimer,
        setBounceTimer: (id) => {
          bounceTimer = id;
        },
      });
      return;
    }

    if (current.kind === "extract" && current.extractFrom !== null) {
      hideExtractGhost(ghostEl);
      ghostEl = null;
      store.setGestureActive(false);
      paint({ camera: liveCamera, straight: false });
      const extract = current.extractFrom;
      const dropTarget = event.target instanceof Element ? event.target : null;
      const sourceStrip = dropTarget?.closest("[data-variant-strip], .variant-strip");
      const sourceNode = sourceStrip?.closest("[data-node-id]");
      const dropOnSourceStrip = sourceNode?.getAttribute("data-node-id") === extract.nodeId;
      const hit = dropOnSourceStrip ? ({ kind: "empty" } as const) : buildHit(screen, false);
      const world = screenToWorld(screen, cameraNow(), view.getSize());
      const commit = decideExtractCommit({
        dropOnSourceStrip,
        hitKind: hit.kind,
        hitNodeId: hit.kind === "slot" ? hit.nodeId : null,
        hitSlotId: hit.kind === "slot" ? hit.slotId : null,
      });
      if (commit.action === "slot") {
        store.extractVariantToSlot(
          extract.nodeId,
          extract.variantId,
          commit.targetNodeId,
          commit.targetSlotId,
          world,
        );
        return;
      }
      if (commit.action === "blank") {
        store.extractVariantToBlank(extract.nodeId, extract.variantId, world);
      }
      return;
    }

    if (current.kind === "reorder-slot" && current.reorderFrom !== null) {
      store.setGestureActive(false);
      paint({ camera: liveCamera, straight: false });
      const drop = event.target instanceof Element ? event.target : null;
      const handle = drop?.closest("[data-slot-handle]");
      const nodeEl = handle?.closest("[data-node-id]");
      const toSlot = handle?.getAttribute("data-slot-handle") ?? handle?.getAttribute("data-slot-id");
      const toNode = nodeEl?.getAttribute("data-node-id");
      if (
        toSlot !== null &&
        toSlot !== undefined &&
        toNode === current.reorderFrom.nodeId &&
        toSlot !== current.reorderFrom.slotId
      ) {
        store.reorderSlots(current.reorderFrom.nodeId, current.reorderFrom.slotId, toSlot);
      }
      return;
    }

    if (current.kind === "pending") {
      store.setGestureActive(false);
      if (current.extractFrom !== null && !current.extractFrom.scrolled) {
        store.clickVariant(current.extractFrom.nodeId, current.extractFrom.variantId);
      } else if (current.hit.kind === "empty") {
        if (!current.shift) {
          store.select([]);
        }
      }
      paint({ camera: liveCamera, straight: false });
      return;
    }

    store.setGestureActive(false);
  };

  const onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    if (!wheelShouldZoom({
      composing: options.isComposing(),
      editable: isEditableTarget(event.target),
      viewerOpen: options.viewerOpen(),
    })) {
      return;
    }
    const rect = el.getBoundingClientRect();
    const viewport = view.getSize();
    const pointer = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    const base = liveCamera.zoom === store.getSnapshot().camera.zoom ? store.getSnapshot().camera : liveCamera;
    liveCamera = applyWheelZoom(base, pointer, viewport, event.deltaY);
    paint({ camera: liveCamera, straight: true });
    if (wheelTimer !== null) {
      window.clearTimeout(wheelTimer);
    }
    wheelTimer = window.setTimeout(() => {
      wheelTimer = null;
      paint({ camera: liveCamera, straight: false });
      commitCameraIfChanged();
    }, VIEWPORT_PUT_IDLE_MS);
  };

  const onAuxClick = (event: MouseEvent): void => {
    if (event.button === 1) {
      event.preventDefault();
    }
  };

  const onContextLost = (): void => {
    spaceDown = false;
    active = null;
    hideExtractGhost(ghostEl);
    ghostEl = null;
    if (bounceTimer !== null) {
      window.cancelAnimationFrame(bounceTimer);
      bounceTimer = null;
    }
    el.classList.remove("is-pan", "is-panning");
    view.applyMarquee(null);
    paint({ camera: store.getSnapshot().camera, straight: false, liveDelta: null, connectLine: null });
    store.setGestureActive(false);
  };

  el.addEventListener("pointerdown", onPointerDown);
  el.addEventListener("pointermove", onPointerMove);
  el.addEventListener("pointerup", endGesture);
  el.addEventListener("pointercancel", endGesture);
  el.addEventListener("wheel", onWheel, { passive: false });
  el.addEventListener("auxclick", onAuxClick);
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("blur", onContextLost);

  const syncCamera = (camera: Camera): void => {
    if (!shouldAdoptStoreCamera(active !== null)) {
      return;
    }
    if (wheelTimer !== null) {
      window.clearTimeout(wheelTimer);
      wheelTimer = null;
    }
    liveCamera = camera;
  };

  const detach = (): void => {
    if (wheelTimer !== null) {
      window.clearTimeout(wheelTimer);
    }
    if (bounceTimer !== null) {
      window.cancelAnimationFrame(bounceTimer);
    }
    hideExtractGhost(ghostEl);
    if (raf !== 0) {
      window.cancelAnimationFrame(raf);
    }
    el.removeEventListener("pointerdown", onPointerDown);
    el.removeEventListener("pointermove", onPointerMove);
    el.removeEventListener("pointerup", endGesture);
    el.removeEventListener("pointercancel", endGesture);
    el.removeEventListener("wheel", onWheel);
    el.removeEventListener("auxclick", onAuxClick);
    window.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("keyup", onKeyUp);
    window.removeEventListener("blur", onContextLost);
  };

  return {
    detach,
    syncCamera,
    getLiveCamera: () => liveCamera,
    isBusy: () => active !== null,
  };
}

function connectTargetFromHit(hit: Hit): ConnectTarget {
  if (hit.kind === "slot") {
    return { type: "slot", nodeId: hit.nodeId, slotId: hit.slotId };
  }
  if (hit.kind === "far-block") {
    return { type: "far" };
  }
  return { type: "empty" };
}

function bounceDurationMs(): number {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return CONNECT_BOUNCE_MS;
  }
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : CONNECT_BOUNCE_MS;
}

function startConnectBounce(input: {
  from: Point;
  to: Point;
  message: string;
  paint: (paint: Partial<LivePaint> & { camera?: Camera }) => void;
  store: EditorStore;
  getBounceTimer: () => number | null;
  setBounceTimer: (id: number | null) => void;
}): void {
  const ms = bounceDurationMs();
  input.paint({ straight: true, connectLine: { from: input.from, to: input.to } });
  const finish = (): void => {
    input.setBounceTimer(null);
    input.paint({ straight: false, connectLine: null });
    input.store.setLastConnectMessage(input.message);
  };
  if (ms <= 0) {
    finish();
    return;
  }
  const started = performance.now();
  const tick = (now: number): void => {
    const t = Math.min(1, (now - started) / ms);
    const ease = 1 - (1 - t) * (1 - t);
    const to = {
      x: input.to.x + (input.from.x - input.to.x) * ease,
      y: input.to.y + (input.from.y - input.to.y) * ease,
    };
    input.paint({ straight: true, connectLine: { from: input.from, to } });
    if (t < 1) {
      input.setBounceTimer(window.requestAnimationFrame(tick));
    } else {
      finish();
    }
  };
  input.setBounceTimer(window.requestAnimationFrame(tick));
}

function leftVariantStrip(strip: Element, event: PointerEvent, leavePx: number): boolean {
  const rect = strip.getBoundingClientRect();
  const pad = leavePx;
  return (
    event.clientX < rect.left - pad ||
    event.clientX > rect.right + pad ||
    event.clientY < rect.top - pad ||
    event.clientY > rect.bottom + pad
  );
}

function showExtractGhost(host: HTMLElement, event: PointerEvent): HTMLElement {
  const ghost = document.createElement("div");
  ghost.className = "extract-ghost";
  ghost.setAttribute("aria-hidden", "true");
  const plus = document.createElement("span");
  plus.className = "extract-ghost-plus";
  plus.textContent = "+";
  ghost.appendChild(plus);
  ghost.style.transform = `translate3d(${event.clientX}px, ${event.clientY}px, 0) scale(${EXTRACT_GHOST_SCALE})`;
  host.appendChild(ghost);
  return ghost;
}

function moveExtractGhost(
  ghost: HTMLElement | null,
  screen: Point,
  hostRect: DOMRect,
): void {
  if (ghost === null) {
    return;
  }
  ghost.style.transform = `translate3d(${hostRect.left + screen.x}px, ${hostRect.top + screen.y}px, 0) scale(${EXTRACT_GHOST_SCALE})`;
}

function hideExtractGhost(ghost: HTMLElement | null): void {
  ghost?.remove();
}

function applyLiveNodeTransforms(
  host: HTMLElement,
  origins: Map<string, { x: number; y: number }>,
  dx: number,
  dy: number,
): void {
  for (const [id, origin] of origins) {
    const nodeEl = host.querySelector(`[data-node-id="${cssEscape(id)}"]`);
    if (nodeEl instanceof HTMLElement) {
      nodeEl.style.transform = nodeTransform(origin.x + dx, origin.y + dy);
    }
  }
}

function cssEscape(id: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(id);
  }
  return id.replace(/"/g, '\\"');
}

function edgeToHit(edge: ProjectEdge, nodes: Record<string, ProjectNode>): { id: string; points: Point[] } {
  const source = nodes[edge.sourceNodeId];
  const target = nodes[edge.targetNodeId];
  if (source === undefined || target === undefined) {
    return { id: edge.id, points: [] };
  }
  const slot = (target.slots ?? []).find((item) => item.id === edge.targetSlotId);
  return {
    id: edge.id,
    points: [outputPortWorld(source), slotPortWorld(target, slot?.order ?? 0)],
  };
}

function groupToHit(
  group: ProjectGroup,
  nodes: Record<string, ProjectNode>,
): { id: string; x: number; y: number; width: number; height: number } {
  const children = group.childIds
    .map((id) => nodes[id])
    .filter((node): node is ProjectNode => node !== undefined);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const node of children) {
    minX = Math.min(minX, node.x);
    minY = Math.min(minY, node.y);
    maxX = Math.max(maxX, node.x + node.width);
    maxY = Math.max(maxY, node.y + node.height);
  }
  if (!Number.isFinite(minX)) {
    return { id: group.id, x: 0, y: 0, width: 0, height: 0 };
  }
  return { id: group.id, x: minX - 24, y: minY - 24, width: maxX - minX + 48, height: maxY - minY + 48 };
}
