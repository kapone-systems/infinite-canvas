import type { Camera } from "@canvas/schema";
import type { EditorStore } from "./EditorStore.ts";
import { CAMERA_ANIM_MS, FIT_PADDING, ZOOM_MIN, ZOOM_MAX } from "./metrics.ts";
import { clampZoom, type Size } from "./coords.ts";

function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  return target.closest("textarea, input, [contenteditable='true']") !== null;
}

export type HistoryKeyLike = {
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  key: string;
};

/** Ctrl/Meta+Z 撤销，Ctrl/Meta+Y 或 Ctrl/Meta+Shift+Z 重做。 */
export function historyKeyAction(event: HistoryKeyLike): "undo" | "redo" | null {
  const ctrl = event.ctrlKey || event.metaKey;
  if (!ctrl) {
    return null;
  }
  const z = event.key === "z" || event.key === "Z";
  const y = event.key === "y" || event.key === "Y";
  if (z && !event.shiftKey) {
    return "undo";
  }
  if (y || (z && event.shiftKey)) {
    return "redo";
  }
  return null;
}

/**
 * 文本节点聚焦时的 GUI 路径：挡住原生撤销，改走命令栈。
 * 组字中只 preventDefault，不提交 undo/redo（第 5.8 节）。
 */
export function applyFocusedTextHistoryKey(
  event: HistoryKeyLike & {
    preventDefault: () => void;
    stopPropagation: () => void;
  },
  input: {
    composing: boolean;
    undo: () => void;
    redo: () => void;
  },
): boolean {
  const action = historyKeyAction(event);
  if (action === null) {
    return false;
  }
  event.preventDefault();
  event.stopPropagation();
  if (input.composing) {
    return true;
  }
  if (action === "undo") {
    input.undo();
  } else {
    input.redo();
  }
  return true;
}

function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function attachShortcuts(input: {
  store: EditorStore;
  getSize: () => Size;
  applyLiveCamera: (camera: Camera) => void;
  commitCamera: (camera: Camera) => void;
  isComposing: () => boolean;
  getLiveCamera?: () => Camera;
}): () => void {
  let anim = 0;

  const cancelAnim = (): void => {
    if (anim !== 0) {
      window.cancelAnimationFrame(anim);
      anim = 0;
    }
  };

  const animateCamera = (to: Camera): void => {
    cancelAnim();
    const from = input.getLiveCamera?.() ?? input.store.getSnapshot().camera;
    const duration = prefersReducedMotion() ? 0 : CAMERA_ANIM_MS;
    if (duration === 0) {
      input.applyLiveCamera(to);
      input.commitCamera(to);
      return;
    }
    const start = performance.now();
    const tick = (now: number): void => {
      const t = Math.min(1, (now - start) / duration);
      const e = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
      const camera: Camera = {
        x: from.x + (to.x - from.x) * e,
        y: from.y + (to.y - from.y) * e,
        zoom: from.zoom + (to.zoom - from.zoom) * e,
      };
      input.applyLiveCamera(camera);
      if (t < 1) {
        anim = window.requestAnimationFrame(tick);
        return;
      }
      anim = 0;
      input.commitCamera(to);
    };
    anim = window.requestAnimationFrame(tick);
  };

  const fitCamera = (): Camera => {
    const snap = input.store.getSnapshot();
    const size = input.getSize();
    if (snap.nodes.length === 0) {
      return { x: 0, y: 0, zoom: 1 };
    }
    const ids = snap.selectedIds.length > 0
      ? new Set(snap.selectedIds)
      : null;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const node of snap.nodes) {
      if (ids !== null && !ids.has(node.id) && (node.groupId === null || !ids.has(node.groupId))) {
        continue;
      }
      minX = Math.min(minX, node.x);
      minY = Math.min(minY, node.y);
      maxX = Math.max(maxX, node.x + node.width);
      maxY = Math.max(maxY, node.y + node.height);
    }
    if (!Number.isFinite(minX)) {
      for (const node of snap.nodes) {
        minX = Math.min(minX, node.x);
        minY = Math.min(minY, node.y);
        maxX = Math.max(maxX, node.x + node.width);
        maxY = Math.max(maxY, node.y + node.height);
      }
    }
    const width = maxX - minX + FIT_PADDING * 2;
    const height = maxY - minY + FIT_PADDING * 2;
    const zoom = clampZoom(Math.min(size.width / width, size.height / height, ZOOM_MAX));
    return {
      x: (minX + maxX) / 2,
      y: (minY + maxY) / 2,
      zoom: Math.max(ZOOM_MIN, zoom),
    };
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    if (input.isComposing()) {
      return;
    }
    if (isEditable(event.target)) {
      return;
    }
    const ctrl = event.ctrlKey || event.metaKey;
    const history = historyKeyAction(event);
    if (history === "undo") {
      event.preventDefault();
      input.store.undo();
      return;
    }
    if (history === "redo") {
      event.preventDefault();
      input.store.redo();
      return;
    }
    if (ctrl && (event.key === "a" || event.key === "A")) {
      event.preventDefault();
      input.store.selectAll();
      return;
    }
    if (ctrl && (event.key === "c" || event.key === "C")) {
      event.preventDefault();
      input.store.copySelection();
      return;
    }
    if (ctrl && (event.key === "v" || event.key === "V")) {
      event.preventDefault();
      input.store.pasteClipboard();
      return;
    }
    if (ctrl && (event.key === "d" || event.key === "D")) {
      event.preventDefault();
      input.store.duplicateSelection();
      return;
    }
    if (ctrl && (event.key === "g" || event.key === "G") && event.shiftKey) {
      event.preventDefault();
      input.store.ungroupSelected();
      return;
    }
    if (ctrl && (event.key === "g" || event.key === "G")) {
      event.preventDefault();
      input.store.groupSelected();
      return;
    }
    if (ctrl && event.key === "0") {
      event.preventDefault();
      const current = input.store.getSnapshot().camera;
      animateCamera({ x: current.x, y: current.y, zoom: 1 });
      return;
    }
    if (ctrl && event.key === "1") {
      event.preventDefault();
      animateCamera(fitCamera());
      return;
    }
    if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      input.store.deleteSelection();
    }
  };

  const onPointerDown = (): void => {
    cancelAnim();
  };

  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("pointerdown", onPointerDown);
  return () => {
    cancelAnim();
    window.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("pointerdown", onPointerDown);
  };
}
