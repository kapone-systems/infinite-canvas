import type { Camera, SlotRole } from "@canvas/schema";
import { worldToScreen, type Point, type Size } from "./coords.ts";
import {
  EDGE_HIT,
  GENERATION_WIDTH,
  GROUP_PAD,
  MARQUEE_DEFAULT_MODE,
  MARQUEE_MODE_INTERSECT,
  outputAnchorLocal,
  SLOT_HIT_CSS_PX,
  SLOT_ROW,
  SLOT_HIT_EXPAND,
  generationNodeHeight,
  slotAnchorY,
  type MarqueeMode,
} from "./metrics.ts";
import { pointInRect, rectContains, rectsIntersect, type WorldRect } from "./spatialIndex.ts";

export type Hit =
  | { kind: "overlay"; id: string }
  | { kind: "slot"; nodeId: string; slotId: string }
  | { kind: "slot-gap"; nodeId: string; role: SlotRole; insertOrder: number }
  | { kind: "output"; nodeId: string }
  | { kind: "near-node"; nodeId: string }
  | { kind: "far-block"; nodeId: string }
  | { kind: "edge"; edgeId: string }
  | { kind: "group"; groupId: string }
  | { kind: "empty" };

export type HitNode = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  z: number;
};

export type HitSlot = {
  nodeId: string;
  slotId: string;
  x: number;
  y: number;
  width: number;
  height: number;
  role?: SlotRole;
  order?: number;
};

export type HitEdge = {
  id: string;
  points: Point[];
};

export type HitGroup = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type HitOverlay = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type HitTestInput = {
  screen: Point;
  world: Point;
  camera: Camera;
  viewport: Size;
  connecting: boolean;
  mountedIds: ReadonlySet<string>;
  overlays?: readonly HitOverlay[];
  slots?: readonly HitSlot[];
  outputs?: readonly { nodeId: string; x: number; y: number }[];
  nodes: readonly HitNode[];
  edges?: readonly HitEdge[];
  groups?: readonly HitGroup[];
  selectedEdgeIds?: ReadonlySet<string>;
};

function screenRectFromWorld(rect: WorldRect, camera: Camera, viewport: Size): WorldRect {
  const origin = worldToScreen({ x: rect.x, y: rect.y }, camera, viewport);
  return {
    x: origin.x,
    y: origin.y,
    width: rect.width * camera.zoom,
    height: rect.height * camera.zoom,
  };
}

function expandRect(rect: WorldRect, pad: number): WorldRect {
  return {
    x: rect.x - pad,
    y: rect.y - pad,
    width: rect.width + pad * 2,
    height: rect.height + pad * 2,
  };
}

function screenSquareAround(world: Point, camera: Camera, viewport: Size, cssSize: number): WorldRect {
  const center = worldToScreen(world, camera, viewport);
  const half = cssSize / 2;
  return { x: center.x - half, y: center.y - half, width: cssSize, height: cssSize };
}

function ranksAbove(a: { z: number; id: string }, b: { z: number; id: string }): boolean {
  return a.z > b.z || (a.z === b.z && a.id > b.id);
}

function pickTopNode(nodes: readonly HitNode[], world: Point): HitNode | null {
  let best: HitNode | null = null;
  for (const node of nodes) {
    if (!pointInRect(world.x, world.y, node)) {
      continue;
    }
    if (best === null || ranksAbove(node, best)) {
      best = node;
    }
  }
  return best;
}

/** 右缘和上缘算在节点外，避免边上的连接桩被算进身体里。 */
function strictInterior(node: HitNode, world: Point): boolean {
  return (
    world.x > node.x &&
    world.y > node.y &&
    world.x < node.x + node.width &&
    world.y < node.y + node.height
  );
}

function distPointToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) {
    return Math.hypot(p.x - a.x, p.y - a.y);
  }
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

function edgeScreenDistance(edge: HitEdge, screen: Point, camera: Camera, viewport: Size): number {
  if (edge.points.length === 0) {
    return Number.POSITIVE_INFINITY;
  }
  const screens = edge.points.map((pt) => worldToScreen(pt, camera, viewport));
  if (screens.length === 1) {
    const only = screens[0];
    if (only === undefined) {
      return Number.POSITIVE_INFINITY;
    }
    return Math.hypot(screen.x - only.x, screen.y - only.y);
  }
  let best = Number.POSITIVE_INFINITY;
  for (let i = 1; i < screens.length; i += 1) {
    const prev = screens[i - 1];
    const next = screens[i];
    if (prev === undefined || next === undefined) {
      continue;
    }
    const d = distPointToSegment(screen, prev, next);
    if (d < best) {
      best = d;
    }
  }
  return best;
}

export function outputPortWorld(node: { x: number; y: number; width: number }): Point {
  const local = outputAnchorLocal(node.width);
  return { x: node.x + local.x, y: node.y + local.y };
}

export function slotWorldRect(node: { x: number; y: number; width: number }, order: number): WorldRect {
  return {
    x: node.x,
    y: node.y + slotAnchorY(order) - SLOT_ROW / 2,
    width: node.width,
    height: SLOT_ROW,
  };
}

export function slotPortWorld(node: { x: number; y: number }, order: number): Point {
  return { x: node.x, y: node.y + slotAnchorY(order) };
}

export function groupFrameFromChildren(children: readonly WorldRect[]): WorldRect | null {
  if (children.length === 0) {
    return null;
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const child of children) {
    minX = Math.min(minX, child.x);
    minY = Math.min(minY, child.y);
    maxX = Math.max(maxX, child.x + child.width);
    maxY = Math.max(maxY, child.y + child.height);
  }
  return {
    x: minX - GROUP_PAD,
    y: minY - GROUP_PAD,
    width: maxX - minX + GROUP_PAD * 2,
    height: maxY - minY + GROUP_PAD * 2,
  };
}

export function marqueeHitsNode(marquee: WorldRect, node: WorldRect, mode: MarqueeMode): boolean {
  if (mode === MARQUEE_MODE_INTERSECT) {
    return rectsIntersect(marquee, node);
  }
  return rectContains(marquee, node);
}

export function marqueeModeFromAlt(altKey: boolean): MarqueeMode {
  return altKey ? MARQUEE_MODE_INTERSECT : MARQUEE_DEFAULT_MODE;
}

/**
 * 重叠夹具：同一世界点既在生成节点槽热区，又在分组框留白里。
 * 命中必须是槽，不是组。
 */
export function overlapSlotNotGroupFixture(): {
  camera: Camera;
  viewport: Size;
  world: Point;
  screen: Point;
  gen: HitNode;
  child: HitNode;
  slot: HitSlot;
  group: HitGroup;
} {
  const camera: Camera = { x: 160, y: 160, zoom: 1 };
  const viewport: Size = { width: 1280, height: 720 };
  const gen: HitNode = {
    id: "gen-overlap",
    x: 0,
    y: 80,
    width: GENERATION_WIDTH,
    height: generationNodeHeight(1, 0),
    z: 1,
  };
  const child: HitNode = {
    id: "child-in-group",
    x: -80,
    y: 100,
    width: 80,
    height: 80,
    z: 2,
  };
  const frame = groupFrameFromChildren([child]);
  if (frame === null) {
    throw new Error("overlap fixture: missing group frame");
  }
  const slotRect = slotWorldRect(gen, 0);
  const slot: HitSlot = {
    nodeId: gen.id,
    slotId: "slot-0",
    x: slotRect.x,
    y: slotRect.y,
    width: slotRect.width,
    height: slotRect.height,
  };
  const world = slotPortWorld(gen, 0);
  return {
    camera,
    viewport,
    world,
    screen: worldToScreen(world, camera, viewport),
    gen,
    child,
    slot,
    group: { id: "group-overlap", ...frame },
  };
}

  /**
   * 命中从上到下：覆盖层 → 槽热区（连线时扩 12px）→ 输出口 → 近景 DOM → 远景色块 → 边（8px）→ 分组框 → 空白。
   * 连接桩热区至少 PORT×PORT CSS 像素。
   * 节点叠在一起时，z 更大的那张挡住下面的槽和输出口，这样最上面的能被拖走，也能从它的输出口拉线。平局取 id 字典序较大。
   * 右缘上的输出口不算进身体里，避免和下面的槽抢点击。
   */
  export function hitTest(input: HitTestInput): Hit {
    const { screen, world, camera, viewport } = input;

    for (const overlay of input.overlays ?? []) {
      if (pointInRect(screen.x, screen.y, overlay)) {
        return { kind: "overlay", id: overlay.id };
      }
    }

    const byId = new Map<string, HitNode>();
    for (const node of input.nodes) {
      byId.set(node.id, node);
    }
    const rankOf = (id: string): { z: number; id: string } => {
      const node = byId.get(id);
      if (node === undefined) {
        return { z: Number.NEGATIVE_INFINITY, id };
      }
      return node;
    };

    const slotExpand = input.connecting ? SLOT_HIT_EXPAND : 0;
    const slotHits: { slot: HitSlot; dist: number }[] = [];
    for (const slot of input.slots ?? []) {
      const screenSlot = screenRectFromWorld(slot, camera, viewport);
      const hitRect = slotExpand > 0 ? expandRect(screenSlot, slotExpand) : screenSlot;
      if (pointInRect(screen.x, screen.y, hitRect)) {
        const cx = screenSlot.x + screenSlot.width / 2;
        const cy = screenSlot.y + screenSlot.height / 2;
        slotHits.push({ slot, dist: Math.hypot(screen.x - cx, screen.y - cy) });
      }
      const port = screenSquareAround(
        { x: slot.x, y: slot.y + slot.height / 2 },
        camera,
        viewport,
        SLOT_HIT_CSS_PX,
      );
      const portHit = slotExpand > 0 ? expandRect(port, slotExpand) : port;
      if (pointInRect(screen.x, screen.y, portHit)) {
        const cx = port.x + port.width / 2;
        const cy = port.y + port.height / 2;
        slotHits.push({ slot, dist: Math.hypot(screen.x - cx, screen.y - cy) });
      }
    }

    const outputHits: { nodeId: string; dist: number }[] = [];
    for (const output of input.outputs ?? []) {
      const port = screenSquareAround(output, camera, viewport, SLOT_HIT_CSS_PX);
      if (pointInRect(screen.x, screen.y, port)) {
        const center = worldToScreen(output, camera, viewport);
        outputHits.push({ nodeId: output.nodeId, dist: Math.hypot(screen.x - center.x, screen.y - center.y) });
      }
    }

    let interior: HitNode | null = null;
    for (const node of input.nodes) {
      if (!strictInterior(node, world)) {
        continue;
      }
      if (interior === null || ranksAbove(node, interior)) {
        interior = node;
      }
    }

    const candidateIds: string[] = [];
    if (interior !== null) {
      candidateIds.push(interior.id);
    }
    for (const hit of slotHits) {
      candidateIds.push(hit.slot.nodeId);
    }
    for (const hit of outputHits) {
      candidateIds.push(hit.nodeId);
    }
    let winner: { z: number; id: string } | null = null;
    for (const id of candidateIds) {
      const rank = rankOf(id);
      if (winner === null || ranksAbove(rank, winner)) {
        winner = rank;
      }
    }

    if (winner !== null) {
      const winnerId = winner.id;
      let bestSlot: HitSlot | null = null;
      let bestSlotDist = Number.POSITIVE_INFINITY;
      for (const hit of slotHits) {
        if (hit.slot.nodeId !== winnerId) {
          continue;
        }
        if (bestSlot === null || hit.dist < bestSlotDist) {
          bestSlot = hit.slot;
          bestSlotDist = hit.dist;
        }
      }
      if (bestSlot !== null && input.connecting && bestSlot.role !== undefined && bestSlot.order !== undefined) {
        const screenSlot = screenRectFromWorld(bestSlot, camera, viewport);
        const fromBottom = screenSlot.y + screenSlot.height - screen.y;
        if (fromBottom >= 0 && fromBottom <= 4) {
          return {
            kind: "slot-gap",
            nodeId: bestSlot.nodeId,
            role: bestSlot.role,
            insertOrder: bestSlot.order + 1,
          };
        }
      }
      if (bestSlot !== null) {
        return { kind: "slot", nodeId: bestSlot.nodeId, slotId: bestSlot.slotId };
      }
      if (outputHits.some((hit) => hit.nodeId === winnerId)) {
        return { kind: "output", nodeId: winnerId };
      }
      if (interior !== null && interior.id === winnerId) {
        if (input.mountedIds.has(interior.id)) {
          return { kind: "near-node", nodeId: interior.id };
        }
        return { kind: "far-block", nodeId: interior.id };
      }
    }

    const top = pickTopNode(input.nodes, world);
  if (top !== null) {
    if (input.mountedIds.has(top.id)) {
      return { kind: "near-node", nodeId: top.id };
    }
    return { kind: "far-block", nodeId: top.id };
  }

  const edges = input.edges ?? [];
  let bestEdge: HitEdge | null = null;
  let bestEdgeDist = Number.POSITIVE_INFINITY;
  let bestSelected: HitEdge | null = null;
  let bestSelectedDist = Number.POSITIVE_INFINITY;
  for (const edge of edges) {
    const dist = edgeScreenDistance(edge, screen, camera, viewport);
    if (dist > EDGE_HIT) {
      continue;
    }
    if (dist < bestEdgeDist) {
      bestEdge = edge;
      bestEdgeDist = dist;
    }
    if (input.selectedEdgeIds?.has(edge.id) === true && dist < bestSelectedDist) {
      bestSelected = edge;
      bestSelectedDist = dist;
    }
  }
  const chosenEdge = bestSelected ?? bestEdge;
  if (chosenEdge !== null) {
    return { kind: "edge", edgeId: chosenEdge.id };
  }

  let bestGroup: HitGroup | null = null;
  for (const group of input.groups ?? []) {
    if (!pointInRect(world.x, world.y, group)) {
      continue;
    }
    if (bestGroup === null || group.id > bestGroup.id) {
      bestGroup = group;
    }
  }
  if (bestGroup !== null) {
    return { kind: "group", groupId: bestGroup.id };
  }

  return { kind: "empty" };
}
