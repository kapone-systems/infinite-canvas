import { CELL } from "./metrics.ts";

export type WorldRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export function rectsIntersect(a: WorldRect, b: WorldRect): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

/** 框选默认：节点矩形完全落入 marquee。 */
export function rectContains(outer: WorldRect, inner: WorldRect): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  );
}

export function pointInRect(x: number, y: number, rect: WorldRect): boolean {
  return x >= rect.x && y >= rect.y && x <= rect.x + rect.width && y <= rect.y + rect.height;
}

function cloneRect(rect: WorldRect): WorldRect {
  return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
}

function cellCoord(value: number): number {
  return Math.floor(value / CELL);
}

function cellKey(cx: number, cy: number): string {
  return `${cx}:${cy}`;
}

function forEachCoveredCell(rect: WorldRect, visit: (cx: number, cy: number) => void): void {
  const x0 = cellCoord(rect.x);
  const y0 = cellCoord(rect.y);
  const x1 = cellCoord(rect.x + Math.max(rect.width, 0));
  const y1 = cellCoord(rect.y + Math.max(rect.height, 0));
  for (let cy = y0; cy <= y1; cy += 1) {
    for (let cx = x0; cx <= x1; cx += 1) {
      visit(cx, cy);
    }
  }
}

export type SpatialIndex = {
  insert(id: string, rect: WorldRect): void;
  remove(id: string): void;
  query(rect: WorldRect): string[];
  clear(): void;
};

export function createSpatialIndex(): SpatialIndex {
  const cells = new Map<string, Set<string>>();
  const rects = new Map<string, WorldRect>();

  const unindex = (id: string, rect: WorldRect): void => {
    forEachCoveredCell(rect, (cx, cy) => {
      const key = cellKey(cx, cy);
      const bucket = cells.get(key);
      if (bucket === undefined) {
        return;
      }
      bucket.delete(id);
      if (bucket.size === 0) {
        cells.delete(key);
      }
    });
  };

  return {
    insert(id: string, rect: WorldRect): void {
      const prev = rects.get(id);
      if (prev !== undefined) {
        unindex(id, prev);
      }
      const stored = cloneRect(rect);
      rects.set(id, stored);
      forEachCoveredCell(stored, (cx, cy) => {
        const key = cellKey(cx, cy);
        let bucket = cells.get(key);
        if (bucket === undefined) {
          bucket = new Set();
          cells.set(key, bucket);
        }
        bucket.add(id);
      });
    },

    remove(id: string): void {
      const prev = rects.get(id);
      if (prev === undefined) {
        return;
      }
      unindex(id, prev);
      rects.delete(id);
    },

    query(rect: WorldRect): string[] {
      if (rect.width < 0 || rect.height < 0) {
        return [];
      }
      const found = new Set<string>();
      forEachCoveredCell(rect, (cx, cy) => {
        const bucket = cells.get(cellKey(cx, cy));
        if (bucket === undefined) {
          return;
        }
        for (const id of bucket) {
          const stored = rects.get(id);
          if (stored !== undefined && rectsIntersect(stored, rect)) {
            found.add(id);
          }
        }
      });
      return [...found].sort();
    },

    clear(): void {
      cells.clear();
      rects.clear();
    },
  };
}
