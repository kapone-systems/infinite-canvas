import { useEffect, useRef, type ReactElement } from "react";
import type { Camera } from "@canvas/schema";
import { GRID_SPACING, LOD_FAR } from "./metrics.ts";
import type { Size } from "./coords.ts";

function dprScale(): number {
  return Math.min(window.devicePixelRatio || 1, 2);
}

export function paintDotGrid(
  canvas: HTMLCanvasElement,
  camera: Camera,
  viewport: Size,
): void {
  const ctx = canvas.getContext("2d");
  if (ctx === null) {
    return;
  }
  const dpr = dprScale();
  const w = Math.max(1, Math.floor(viewport.width * dpr));
  const h = Math.max(1, Math.floor(viewport.height * dpr));
  if (canvas.width !== w) {
    canvas.width = w;
  }
  if (canvas.height !== h) {
    canvas.height = h;
  }
  canvas.style.width = `${viewport.width}px`;
  canvas.style.height = `${viewport.height}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, viewport.width, viewport.height);
  if (camera.zoom < LOD_FAR) {
    return;
  }
  const originX = viewport.width / 2 - camera.x * camera.zoom;
  const originY = viewport.height / 2 - camera.y * camera.zoom;
  const spacing = GRID_SPACING;
  let startX = originX % spacing;
  if (startX < 0) {
    startX += spacing;
  }
  let startY = originY % spacing;
  if (startY < 0) {
    startY += spacing;
  }
  const col0 = Math.round((startX - originX) / spacing);
  const row0 = Math.round((startY - originY) / spacing);
  let col = col0;
  for (let x = startX; x <= viewport.width; x += spacing) {
    let row = row0;
    for (let y = startY; y <= viewport.height; y += spacing) {
      const major = col % 4 === 0 || row % 4 === 0;
      ctx.fillStyle = major ? "rgba(255,255,255,0.10)" : "rgba(255,255,255,0.06)";
      ctx.fillRect(x, y, 1.5, 1.5);
      row += 1;
    }
    col += 1;
  }
}

export function DotGrid(props: {
  canvasRef: { current: HTMLCanvasElement | null };
}): ReactElement {
  const inner = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    props.canvasRef.current = inner.current;
  });
  return <canvas ref={inner} className="dot-grid" aria-hidden="true" />;
}
