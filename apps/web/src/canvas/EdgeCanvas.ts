import type { Camera, ProjectEdge, ProjectGroup, ProjectNode } from "@canvas/schema";
import { worldToScreen, type Point, type Size } from "./coords.ts";
import {
  BLOCK_COLOR,
  FAR_TITLE_MIN_SCREEN_PX,
  LOD_FAR,
  SELECTED_STROKE,
  SLOT_ROLE_STROKE,
  STALE_BAR,
  outputAnchorLocal,
  slotAnchorY,
} from "./metrics.ts";
import { groupFrameFromChildren } from "./hitTest.ts";
import { farTitleVisible, lodBand } from "./lod.ts";

export type LiveDelta = {
  ids: ReadonlySet<string>;
  dx: number;
  dy: number;
};

export type EdgePaintInput = {
  camera: Camera;
  viewport: Size;
  nodes: readonly ProjectNode[];
  edges: readonly ProjectEdge[];
  groups: readonly ProjectGroup[];
  mountedIds: ReadonlySet<string>;
  selectedIds: ReadonlySet<string>;
  selectedEdgeIds: ReadonlySet<string>;
  liveDelta: LiveDelta | null;
  straight: boolean;
  connectLine: { from: Point; to: Point } | null;
};

function dprScale(): number {
  return Math.min(window.devicePixelRatio || 1, 2);
}

function livePos(node: ProjectNode, live: LiveDelta | null): Point {
  if (live !== null && live.ids.has(node.id)) {
    return { x: node.x + live.dx, y: node.y + live.dy };
  }
  return { x: node.x, y: node.y };
}

function blockFill(node: ProjectNode): string {
  if (node.kind === "text") {
    return BLOCK_COLOR.text;
  }
  if (node.kind === "image") {
    return BLOCK_COLOR.image;
  }
  if (node.kind === "video") {
    return BLOCK_COLOR.video;
  }
  if (node.kind === "audio") {
    return BLOCK_COLOR.audio;
  }
  if (node.phase === "failed") {
    return BLOCK_COLOR.generationFailed;
  }
  if (node.phase === "queued" || node.phase === "running") {
    return BLOCK_COLOR.generationBusy;
  }
  return BLOCK_COLOR.generationIdle;
}

/** 远景播放三角：视频素材，以及 outputKind 为 video 的生成节点。文生图不加。 */
export function shouldPaintPlayTriangle(node: Pick<ProjectNode, "kind" | "outputKind">): boolean {
  if (node.kind === "video") {
    return true;
  }
  return node.kind === "generation" && node.outputKind === "video";
}

/** 选中的边用选中色和更粗的线，不另加 DOM。 */
export function edgePaintStyle(input: {
  selected: boolean;
  straight: boolean;
  roleStroke: string;
}): { stroke: string; width: number } {
  if (input.selected) {
    return { stroke: SELECTED_STROKE, width: 3 };
  }
  return { stroke: input.roleStroke, width: input.straight ? 1 : 1.5 };
}

export type PlayTriangleCtx = {
  fillStyle: string | CanvasGradient | CanvasPattern;
  beginPath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  closePath(): void;
  fill(): void;
};

export function paintPlayTriangle(ctx: PlayTriangleCtx, x: number, y: number, w: number, h: number): void {
  const size = Math.max(8, Math.min(w, h) * 0.22);
  const cx = x + w / 2;
  const cy = y + h / 2;
  ctx.fillStyle = "#f4f4f4";
  ctx.beginPath();
  ctx.moveTo(cx - size * 0.35, cy - size * 0.5);
  ctx.lineTo(cx + size * 0.55, cy);
  ctx.lineTo(cx - size * 0.35, cy + size * 0.5);
  ctx.closePath();
  ctx.fill();
}

function outputWorld(node: ProjectNode, live: LiveDelta | null): Point {
  const pos = livePos(node, live);
  const local = outputAnchorLocal(node.width);
  return { x: pos.x + local.x, y: pos.y + local.y };
}

function slotWorld(node: ProjectNode, order: number, live: LiveDelta | null): Point {
  const pos = livePos(node, live);
  return { x: pos.x, y: pos.y + slotAnchorY(order) };
}

function bezier(ctx: CanvasRenderingContext2D, a: Point, b: Point): void {
  const dx = Math.max(40, Math.abs(b.x - a.x) * 0.45);
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.bezierCurveTo(a.x + dx, a.y, b.x - dx, b.y, b.x, b.y);
  ctx.stroke();
}

function straight(ctx: CanvasRenderingContext2D, a: Point, b: Point): void {
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
}

export class EdgeCanvasRenderer {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext("2d");
    if (ctx === null) {
      throw new Error("2d");
    }
    this.ctx = ctx;
  }

  resize(cssWidth: number, cssHeight: number): void {
    const dpr = dprScale();
    const w = Math.max(1, Math.floor(cssWidth * dpr));
    const h = Math.max(1, Math.floor(cssHeight * dpr));
    if (this.canvas.width !== w) {
      this.canvas.width = w;
    }
    if (this.canvas.height !== h) {
      this.canvas.height = h;
    }
    this.canvas.style.width = `${cssWidth}px`;
    this.canvas.style.height = `${cssHeight}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  paint(input: EdgePaintInput): void {
    const { camera, viewport, ctx } = { ...input, ctx: this.ctx };
    ctx.clearRect(0, 0, viewport.width, viewport.height);
    const band = lodBand(camera.zoom);
    const byId = new Map(input.nodes.map((node) => [node.id, node]));
    const live = input.liveDelta;

    for (const group of input.groups) {
      const children = group.childIds
        .map((id) => byId.get(id))
        .filter((node): node is ProjectNode => node !== undefined)
        .map((node) => {
          const pos = livePos(node, live);
          return { x: pos.x, y: pos.y, width: node.width, height: node.height };
        });
      const frame = groupFrameFromChildren(children);
      if (frame === null) {
        continue;
      }
      const origin = worldToScreen({ x: frame.x, y: frame.y }, camera, viewport);
      ctx.strokeStyle = input.selectedIds.has(group.id) ? SELECTED_STROKE : "rgba(255,255,255,0.22)";
      ctx.lineWidth = input.selectedIds.has(group.id) ? 2 : 1;
      ctx.strokeRect(origin.x, origin.y, frame.width * camera.zoom, frame.height * camera.zoom);
    }

    if (band !== "near") {
      for (const node of input.nodes) {
        this.paintBlock(node, camera, viewport, live, input.selectedIds.has(node.id), band !== "far");
      }
    } else {
      for (const node of input.nodes) {
        if (input.mountedIds.has(node.id)) {
          if (input.selectedIds.has(node.id)) {
            this.paintSelectedRect(node, camera, viewport, live);
          }
          continue;
        }
        this.paintBlock(node, camera, viewport, live, input.selectedIds.has(node.id), true);
      }
    }

    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    const plain: ProjectEdge[] = [];
    const chosen: ProjectEdge[] = [];
    for (const edge of input.edges) {
      if (input.selectedEdgeIds.has(edge.id)) {
        chosen.push(edge);
      } else {
        plain.push(edge);
      }
    }
    for (const edge of plain) {
      this.strokeEdge(edge, byId, camera, viewport, live, input.straight, false);
    }
    for (const edge of chosen) {
      this.strokeEdge(edge, byId, camera, viewport, live, input.straight, true);
    }

    if (input.connectLine !== null) {
      ctx.strokeStyle = "#c8e0ff";
      ctx.setLineDash([6, 4]);
      const from = worldToScreen(input.connectLine.from, camera, viewport);
      const to = worldToScreen(input.connectLine.to, camera, viewport);
      straight(ctx, from, to);
      ctx.setLineDash([]);
    }
  }

  private strokeEdge(
    edge: ProjectEdge,
    byId: Map<string, ProjectNode>,
    camera: Camera,
    viewport: Size,
    live: LiveDelta | null,
    straightLine: boolean,
    selected: boolean,
  ): void {
    const source = byId.get(edge.sourceNodeId);
    const target = byId.get(edge.targetNodeId);
    if (source === undefined || target === undefined) {
      return;
    }
    const style = edgePaintStyle({
      selected,
      straight: straightLine,
      roleStroke: SLOT_ROLE_STROKE[edge.role] ?? "#8ab4ff",
    });
    this.ctx.strokeStyle = style.stroke;
    this.ctx.lineWidth = style.width;
    const from = worldToScreen(outputWorld(source, live), camera, viewport);
    const slot = (target.slots ?? []).find((item) => item.id === edge.targetSlotId);
    const order = slot?.order ?? 0;
    const to = worldToScreen(slotWorld(target, order, live), camera, viewport);
    if (straightLine) {
      straight(this.ctx, from, to);
    } else {
      bezier(this.ctx, from, to);
    }
  }

  private paintSelectedRect(
    node: ProjectNode,
    camera: Camera,
    viewport: Size,
    live: LiveDelta | null,
  ): void {
    const pos = livePos(node, live);
    const origin = worldToScreen(pos, camera, viewport);
    this.ctx.strokeStyle = SELECTED_STROKE;
    this.ctx.lineWidth = 2;
    this.ctx.strokeRect(origin.x, origin.y, node.width * camera.zoom, node.height * camera.zoom);
  }

  private paintBlock(
    node: ProjectNode,
    camera: Camera,
    viewport: Size,
    live: LiveDelta | null,
    selected: boolean,
    withTitle: boolean,
  ): void {
    const pos = livePos(node, live);
    const origin = worldToScreen(pos, camera, viewport);
    const w = node.width * camera.zoom;
    const h = node.height * camera.zoom;
    this.ctx.fillStyle = blockFill(node);
    this.ctx.fillRect(origin.x, origin.y, w, h);
    if (shouldPaintPlayTriangle(node)) {
      paintPlayTriangle(this.ctx, origin.x, origin.y, w, h);
    }
    if (node.freshness === "stale") {
      this.ctx.fillStyle = STALE_BAR;
      this.ctx.fillRect(origin.x, origin.y, w, 4);
    }
    if (selected) {
      this.ctx.strokeStyle = SELECTED_STROKE;
      this.ctx.lineWidth = 2;
      this.ctx.strokeRect(origin.x, origin.y, w, h);
    }
    const showTitle =
      withTitle && (camera.zoom >= LOD_FAR || farTitleVisible(node.width, camera.zoom) || w >= FAR_TITLE_MIN_SCREEN_PX);
    if (showTitle && w >= FAR_TITLE_MIN_SCREEN_PX) {
      this.ctx.fillStyle = "#f4f4f4";
      this.ctx.font = "12px Segoe UI, system-ui, sans-serif";
      this.ctx.textBaseline = "middle";
      this.ctx.save();
      this.ctx.beginPath();
      this.ctx.rect(origin.x + 4, origin.y, w - 8, Math.min(24, h));
      this.ctx.clip();
      this.ctx.fillText(node.title, origin.x + 6, origin.y + Math.min(14, h / 2));
      this.ctx.restore();
    }
  }
}
