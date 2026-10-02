import { TEXT_MAX_CHARS, type Camera } from "@canvas/schema";
import type { EditorStore } from "./EditorStore.ts";
import { CAMERA_ANIM_MS, FIT_PADDING, ZOOM_MIN, ZOOM_MAX } from "./metrics.ts";
import { clampZoom, type Size } from "./coords.ts";

export type SlotKeyPlan = "reorder-up" | "reorder-down" | "disconnect" | "remove" | "delete-selection" | null;

/** 焦点在槽行上时 Alt+方向重排，Delete 只断开，空槽 Backspace 才删槽。 */
export function slotKeyPlan(input: {
  key: string;
  altKey: boolean;
  slotFocused: boolean;
  slotEmpty: boolean;
}): SlotKeyPlan {
  if (input.slotFocused) {
    if (input.altKey && input.key === "ArrowUp") {
      return "reorder-up";
    }
    if (input.altKey && input.key === "ArrowDown") {
      return "reorder-down";
    }
    if (input.key === "Delete") {
      return "disconnect";
    }
    if (input.key === "Backspace") {
      return input.slotEmpty ? "remove" : null;
    }
    return null;
  }
  if (input.key === "Delete" || input.key === "Backspace") {
    return "delete-selection";
  }
  return null;
}

export function adjacentSameRoleSlotId(
  slots: readonly { id: string; role: string; order: number }[],
  slotId: string,
  direction: "up" | "down",
): string | null {
  const slot = slots.find((item) => item.id === slotId);
  if (slot === undefined) {
    return null;
  }
  const same = slots.filter((item) => item.role === slot.role).sort((a, b) => a.order - b.order);
  const index = same.findIndex((item) => item.id === slotId);
  if (index < 0) {
    return null;
  }
  const next = same[index + (direction === "up" ? -1 : 1)];
  return next?.id ?? null;
}

export function readFocusedSlot(target: EventTarget | null): { nodeId: string; slotId: string } | null {
  if (!(target instanceof Element)) {
    return null;
  }
  const row = target.closest(".node-slot");
  if (!(row instanceof Element)) {
    return null;
  }
  const slotId = row.getAttribute("data-slot-id");
  const nodeId = row.closest("[data-node-id]")?.getAttribute("data-node-id") ?? null;
  if (slotId === null || slotId === "" || nodeId === null || nodeId === "") {
    return null;
  }
  return { nodeId, slotId };
}

export type SystemPastePlan = "yield" | "files" | "text" | "too-long" | "session";

/**
 * 输入框交给浏览器。有文件走导入。
 * 会话里已经有复制的节点时，Ctrl+V 贴节点，不把系统剪贴板里的旧文字当成新文本。
 * 没有会话副本时，不过长的 text/plain 才新建文本。
 */
export function planSystemPaste(input: {
  inField: boolean;
  fileCount: number;
  text: string;
  hasSessionClipboard: boolean;
}): SystemPastePlan {
  if (input.inField) {
    return "yield";
  }
  if (input.fileCount > 0) {
    return "files";
  }
  if (input.hasSessionClipboard) {
    return "session";
  }
  if (input.text.length > TEXT_MAX_CHARS) {
    return "too-long";
  }
  if (input.text.length > 0) {
    return "text";
  }
  return "session";
}

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
    const focused = readFocusedSlot(event.target);
    const focusedNode = focused !== null ? input.store.nodeMap()[focused.nodeId] : undefined;
    const focusedSlot = focusedNode?.slots?.find((item) => item.id === focused?.slotId);
    const plan = slotKeyPlan({
      key: event.key,
      altKey: event.altKey,
      slotFocused: focused !== null,
      slotEmpty: focusedSlot?.edgeId == null,
    });
    if (focused !== null && (plan === "reorder-up" || plan === "reorder-down")) {
      event.preventDefault();
      const slots = focusedNode?.slots ?? [];
      const neighbor = adjacentSameRoleSlotId(slots, focused.slotId, plan === "reorder-up" ? "up" : "down");
      if (neighbor !== null) {
        input.store.reorderSlots(focused.nodeId, focused.slotId, neighbor);
      }
      return;
    }
    if (plan === "disconnect" && focused !== null) {
      event.preventDefault();
      input.store.disconnectSlot(focused.nodeId, focused.slotId);
      return;
    }
    if (plan === "remove" && focused !== null) {
      event.preventDefault();
      input.store.removeSlot(focused.nodeId, focused.slotId);
      return;
    }
    if (plan === "delete-selection") {
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
