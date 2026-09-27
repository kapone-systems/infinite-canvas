import type { Camera, ProjectNode } from "@canvas/schema";
import type { Size } from "./coords.ts";
import { MINIMAP_HEIGHT, MINIMAP_WIDTH } from "./metrics.ts";
import { BLOCK_COLOR } from "./metrics.ts";
import type { LiveDelta } from "./EdgeCanvas.ts";

function fillFor(node: ProjectNode): string {
  if (node.kind === "text") {
    return BLOCK_COLOR.text;
  }
  if (node.kind === "image") {
    return BLOCK_COLOR.image;
  }
  if (node.kind === "generation") {
    return BLOCK_COLOR.generationIdle;
  }
  if (node.kind === "video") {
    return BLOCK_COLOR.video;
  }
  return BLOCK_COLOR.audio;
}

export type MinimapBounds = {
  minX: number;
  minY: number;
  width: number;
  height: number;
};

export function contentBounds(nodes: readonly ProjectNode[]): MinimapBounds | null {
  if (nodes.length === 0) {
    return null;
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const node of nodes) {
    minX = Math.min(minX, node.x);
    minY = Math.min(minY, node.y);
    maxX = Math.max(maxX, node.x + node.width);
    maxY = Math.max(maxY, node.y + node.height);
  }
  const pad = 80;
  return {
    minX: minX - pad,
    minY: minY - pad,
    width: Math.max(1, maxX - minX + pad * 2),
    height: Math.max(1, maxY - minY + pad * 2),
  };
}

export function paintMinimap(input: {
  canvas: HTMLCanvasElement;
  camera: Camera;
  viewport: Size;
  nodes: readonly ProjectNode[];
  liveDelta: LiveDelta | null;
}): void {
  const ctx = input.canvas.getContext("2d");
  if (ctx === null) {
    return;
  }
  const w = MINIMAP_WIDTH;
  const h = MINIMAP_HEIGHT;
  if (input.canvas.width !== w) {
    input.canvas.width = w;
  }
  if (input.canvas.height !== h) {
    input.canvas.height = h;
  }
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = "#1a1a1a";
  ctx.fillRect(0, 0, w, h);
  const bounds = contentBounds(input.nodes);
  if (bounds === null) {
    return;
  }
  const scale = Math.min(w / bounds.width, h / bounds.height);
  const ox = (w - bounds.width * scale) / 2;
  const oy = (h - bounds.height * scale) / 2;
  for (const node of input.nodes) {
    let x = node.x;
    let y = node.y;
    if (input.liveDelta !== null && input.liveDelta.ids.has(node.id)) {
      x += input.liveDelta.dx;
      y += input.liveDelta.dy;
    }
    ctx.fillStyle = fillFor(node);
    ctx.fillRect(
      ox + (x - bounds.minX) * scale,
      oy + (y - bounds.minY) * scale,
      Math.max(2, node.width * scale),
      Math.max(2, node.height * scale),
    );
  }
  const viewW = input.viewport.width / input.camera.zoom;
  const viewH = input.viewport.height / input.camera.zoom;
  const vx = input.camera.x - viewW / 2;
  const vy = input.camera.y - viewH / 2;
  ctx.strokeStyle = "#9ec1ff";
  ctx.lineWidth = 1;
  ctx.strokeRect(
    ox + (vx - bounds.minX) * scale,
    oy + (vy - bounds.minY) * scale,
    viewW * scale,
    viewH * scale,
  );
}

export function minimapToWorld(
  clientX: number,
  clientY: number,
  canvas: HTMLCanvasElement,
  nodes: readonly ProjectNode[],
): { x: number; y: number } | null {
  const bounds = contentBounds(nodes);
  if (bounds === null) {
    return null;
  }
  const rect = canvas.getBoundingClientRect();
  const w = rect.width;
  const h = rect.height;
  const scale = Math.min(w / bounds.width, h / bounds.height);
  const ox = (w - bounds.width * scale) / 2;
  const oy = (h - bounds.height * scale) / 2;
  const px = clientX - rect.left;
  const py = clientY - rect.top;
  return {
    x: bounds.minX + (px - ox) / scale,
    y: bounds.minY + (py - oy) / scale,
  };
}
