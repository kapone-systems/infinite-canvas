import { useEffect, useRef, type ReactElement, type ReactNode } from "react";
import type { Camera, ProjectNode } from "@canvas/schema";
import { worldLayerTransform, type Size } from "./coords.ts";
import { DotGrid, paintDotGrid } from "./DotGrid.tsx";
import { EdgeCanvasRenderer, type LiveDelta } from "./EdgeCanvas.ts";
import type { EditorStore } from "./EditorStore.ts";
import { attachCanvasGestures, type LivePaint } from "./gestures.ts";
import { lodBand, type LodBand } from "./lod.ts";
import { MINIMAP_HEIGHT, MINIMAP_NODE_THRESHOLD, MINIMAP_WIDTH } from "./metrics.ts";
import { minimapToWorld, paintMinimap } from "./Minimap.ts";
import { applyMarqueeRect, Overlay } from "./Overlay.tsx";
import { DevOverlay, type DevOverlayStats } from "./DevOverlay.tsx";
import { attachShortcuts } from "./shortcuts.ts";

export function Viewport(props: {
  store: EditorStore;
  camera: Camera;
  composing: boolean;
  textEditing: boolean;
  mountedIds: readonly string[];
  selectedIds: readonly string[];
  selectedCount: number;
  nodes: readonly ProjectNode[];
  thumbCount: number;
  onCameraCommit: (camera: Camera) => void;
  onStartTextEdit: (nodeId: string) => void;
  viewerOpen: boolean;
  children: ReactNode;
}): ReactElement {
  const hostRef = useRef<HTMLDivElement>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLCanvasElement | null>(null);
  const edgeRef = useRef<HTMLCanvasElement>(null);
  const marqueeRef = useRef<HTMLDivElement | null>(null);
  const minimapRef = useRef<HTMLCanvasElement>(null);
  const edgePainter = useRef<EdgeCanvasRenderer | null>(null);
  const cameraRef = useRef(props.camera);
  const composingRef = useRef(props.composing);
  const textEditingRef = useRef(props.textEditing);
  const viewerOpenRef = useRef(props.viewerOpen);
  const commitRef = useRef(props.onCameraCommit);
  const storeRef = useRef(props.store);
  const mountedRef = useRef(new Set(props.mountedIds));
  const selectedRef = useRef(new Set(props.selectedIds));
  const nodesRef = useRef(props.nodes);
  const liveDeltaRef = useRef<LiveDelta | null>(null);
  const straightRef = useRef(false);
  const connectRef = useRef<LivePaint["connectLine"]>(null);
  const sizeRef = useRef<Size>({ width: 1280, height: 720 });
  const statsRef = useRef<DevOverlayStats>({
    frameMs: 0,
    over32: 0,
    lod: lodBand(props.camera.zoom),
    mounted: props.mountedIds.length,
    thumbs: props.thumbCount,
  });
  const startEditRef = useRef(props.onStartTextEdit);
  const gestureSessionRef = useRef<ReturnType<typeof attachCanvasGestures> | null>(null);

  if (!props.store.getSnapshot().gestureActive) {
    cameraRef.current = props.camera;
  }
  composingRef.current = props.composing;
  textEditingRef.current = props.textEditing;
  viewerOpenRef.current = props.viewerOpen;
  commitRef.current = props.onCameraCommit;
  storeRef.current = props.store;
  mountedRef.current = new Set(props.mountedIds);
  selectedRef.current = new Set(props.selectedIds);
  nodesRef.current = props.nodes;
  startEditRef.current = props.onStartTextEdit;
  statsRef.current.lod = lodBand(props.camera.zoom);
  statsRef.current.mounted = props.mountedIds.length;
  statsRef.current.thumbs = props.thumbCount;

  const paintAll = (camera: Camera): void => {
    const host = hostRef.current;
    const layer = layerRef.current;
    const grid = gridRef.current;
    if (host === null || layer === null) {
      return;
    }
    const size: Size = {
      width: host.clientWidth || 1280,
      height: host.clientHeight || 720,
    };
    sizeRef.current = size;
    layer.style.transform = worldLayerTransform(camera, size);
    if (grid !== null) {
      paintDotGrid(grid, camera, size);
    }
    const edgeCanvas = edgeRef.current;
    if (edgeCanvas !== null) {
      if (edgePainter.current === null) {
        edgePainter.current = new EdgeCanvasRenderer(edgeCanvas);
      }
      edgePainter.current.resize(size.width, size.height);
      const project = storeRef.current.getSnapshot().project;
      edgePainter.current.paint({
        camera,
        viewport: size,
        nodes: nodesRef.current,
        edges: Object.values(storeRef.current.edgeMap()),
        groups: Object.values(storeRef.current.groupMap()),
        mountedIds: mountedRef.current,
        selectedIds: selectedRef.current,
        liveDelta: liveDeltaRef.current,
        straight: straightRef.current,
        connectLine: connectRef.current,
      });
      void project;
    }
    const mini = minimapRef.current;
    if (mini !== null && nodesRef.current.length >= MINIMAP_NODE_THRESHOLD) {
      paintMinimap({
        canvas: mini,
        camera,
        viewport: size,
        nodes: nodesRef.current,
        liveDelta: liveDeltaRef.current,
      });
    }
  };

  useEffect(() => {
    const host = hostRef.current;
    const layer = layerRef.current;
    if (host === null || layer === null) {
      return;
    }
    paintAll(cameraRef.current);
    const resize = new ResizeObserver(() => {
      paintAll(cameraRef.current);
    });
    resize.observe(host);
    const session = attachCanvasGestures({
      store: storeRef.current,
      view: {
        host,
        getSize: () => sizeRef.current,
        applyLive: (paint) => {
          cameraRef.current = paint.camera;
          liveDeltaRef.current = paint.liveDelta;
          straightRef.current = paint.straight;
          connectRef.current = paint.connectLine;
          paintAll(paint.camera);
        },
        applyMarquee: (rect) => {
          applyMarqueeRect(marqueeRef.current, rect);
        },
        classSelect: (ids) => {
          selectedRef.current = new Set(ids);
          for (const nodeEl of host.querySelectorAll("[data-node-id]")) {
            if (!(nodeEl instanceof HTMLElement)) {
              continue;
            }
            const id = nodeEl.getAttribute("data-node-id");
            nodeEl.classList.toggle("is-selected", id !== null && ids.has(id));
          }
          paintAll(cameraRef.current);
        },
      },
      getMountedIds: () => mountedRef.current,
      isTextEditing: () => textEditingRef.current,
      isComposing: () => composingRef.current,
      viewerOpen: () => viewerOpenRef.current,
      onStartTextEdit: (id) => {
        startEditRef.current(id);
      },
      commitCamera: (camera) => {
        cameraRef.current = camera;
        paintAll(camera);
        commitRef.current(camera);
      },
    });
    gestureSessionRef.current = session;
    const detachShortcuts = attachShortcuts({
      store: storeRef.current,
      getSize: () => sizeRef.current,
      getLiveCamera: () => cameraRef.current,
      applyLiveCamera: (camera) => {
        cameraRef.current = camera;
        session.syncCamera(camera);
        paintAll(camera);
      },
      commitCamera: (camera) => {
        cameraRef.current = camera;
        session.syncCamera(camera);
        paintAll(camera);
        commitRef.current(camera);
      },
      isComposing: () => composingRef.current,
    });
    const mini = minimapRef.current;
    const onMiniDown = (event: PointerEvent): void => {
      if (mini === null) {
        return;
      }
      const world = minimapToWorld(event.clientX, event.clientY, mini, nodesRef.current);
      if (world === null) {
        return;
      }
      const next = { ...cameraRef.current, x: world.x, y: world.y };
      cameraRef.current = next;
      session.syncCamera(next);
      paintAll(next);
      mini.setPointerCapture(event.pointerId);
    };
    const onMiniMove = (event: PointerEvent): void => {
      if (mini === null || !mini.hasPointerCapture(event.pointerId)) {
        return;
      }
      const world = minimapToWorld(event.clientX, event.clientY, mini, nodesRef.current);
      if (world === null) {
        return;
      }
      const next = { ...cameraRef.current, x: world.x, y: world.y };
      cameraRef.current = next;
      session.syncCamera(next);
      paintAll(next);
    };
    const onMiniUp = (event: PointerEvent): void => {
      if (mini === null || !mini.hasPointerCapture(event.pointerId)) {
        return;
      }
      session.syncCamera(cameraRef.current);
      commitRef.current(cameraRef.current);
    };
    mini?.addEventListener("pointerdown", onMiniDown);
    mini?.addEventListener("pointermove", onMiniMove);
    mini?.addEventListener("pointerup", onMiniUp);
    return () => {
      resize.disconnect();
      session.detach();
      gestureSessionRef.current = null;
      detachShortcuts();
      mini?.removeEventListener("pointerdown", onMiniDown);
      mini?.removeEventListener("pointermove", onMiniMove);
      mini?.removeEventListener("pointerup", onMiniUp);
    };
  }, []);

  useEffect(() => {
    const busy = props.store.getSnapshot().gestureActive;
    if (!busy) {
      gestureSessionRef.current?.syncCamera(props.camera);
      cameraRef.current = props.camera;
    }
    liveDeltaRef.current = null;
    straightRef.current = false;
    paintAll(cameraRef.current);
  }, [props.camera, props.nodes, props.mountedIds, props.selectedIds, props.store]);

  const lod: LodBand = lodBand(props.camera.zoom);
  void lod;
  const showMinimap = props.nodes.length >= MINIMAP_NODE_THRESHOLD;

  return (
    <div ref={hostRef} className="viewport">
      <DotGrid canvasRef={gridRef} />
      <canvas ref={edgeRef} className="edge-canvas" aria-hidden="true" />
      <div ref={layerRef} className="world-layer">
        {props.children}
      </div>
      <Overlay
        selectedCount={props.selectedCount}
        marqueeRef={marqueeRef}
        connectMessage={props.store.getSnapshot().lastConnectMessage}
      />
      {showMinimap ? (
        <canvas
          ref={minimapRef}
          className="minimap"
          width={MINIMAP_WIDTH}
          height={MINIMAP_HEIGHT}
          aria-label="小地图"
        />
      ) : (
        <canvas ref={minimapRef} className="minimap" hidden width={MINIMAP_WIDTH} height={MINIMAP_HEIGHT} />
      )}
      <DevOverlay statsRef={statsRef} />
    </div>
  );
}
