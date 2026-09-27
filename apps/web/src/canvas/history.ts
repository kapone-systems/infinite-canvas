import type {
  CanvasProjectFile,
  ProjectEdge,
  ProjectGroup,
  ProjectNode,
} from "@canvas/schema";
import { HISTORY_LIMIT } from "./metrics.ts";

/** 方案阶段 2 原文。 */
export type Op =
  | { op: "set"; path: string; value: unknown; prev: unknown }
  | { op: "put-node"; node: ProjectNode }
  | { op: "drop-node"; id: string; node: ProjectNode }
  | { op: "put-edge"; edge: ProjectEdge }
  | { op: "drop-edge"; id: string; edge: ProjectEdge }
  | { op: "put-group"; group: ProjectGroup }
  | { op: "drop-group"; id: string; group: ProjectGroup };

export interface HistoryEntry {
  id: string;
  label: string;
  redo: Op[];
  undo: Op[];
  coalesceKey?: string;
  selectAfterRedo: string[];
  selectAfterUndo: string[];
}

export function invertOp(op: Op): Op {
  switch (op.op) {
    case "set":
      return { op: "set", path: op.path, value: op.prev, prev: op.value };
    case "put-node":
      return { op: "drop-node", id: op.node.id, node: op.node };
    case "drop-node":
      return { op: "put-node", node: op.node };
    case "put-edge":
      return { op: "drop-edge", id: op.edge.id, edge: op.edge };
    case "drop-edge":
      return { op: "put-edge", edge: op.edge };
    case "put-group":
      return { op: "drop-group", id: op.group.id, group: op.group };
    case "drop-group":
      return { op: "put-group", group: op.group };
  }
}

export function invertOps(ops: readonly Op[]): Op[] {
  const out: Op[] = [];
  for (let i = ops.length - 1; i >= 0; i -= 1) {
    const op = ops[i];
    if (op !== undefined) {
      out.push(invertOp(op));
    }
  }
  return out;
}

export function textCoalesceKey(nodeId: string, field: string): string {
  return `text:${nodeId}:${field}`;
}

export function nudgeCoalesceKey(ids: readonly string[]): string {
  return `nudge:${[...ids].sort().join(",")}`;
}

export function createHistoryEntry(input: {
  id?: string;
  label: string;
  redo: Op[];
  undo?: Op[];
  coalesceKey?: string;
  selectAfterRedo: string[];
  selectAfterUndo: string[];
}): HistoryEntry {
  const entry: HistoryEntry = {
    id: input.id ?? crypto.randomUUID(),
    label: input.label,
    redo: input.redo,
    undo: input.undo ?? invertOps(input.redo),
    selectAfterRedo: input.selectAfterRedo,
    selectAfterUndo: input.selectAfterUndo,
  };
  if (input.coalesceKey !== undefined) {
    entry.coalesceKey = input.coalesceKey;
  }
  return entry;
}

/** 一次拖拽松手：全部节点坐标写成一条记录，不跨手势合并。 */
export function moveNodesEntry(input: {
  id?: string;
  label?: string;
  moves: readonly {
    id: string;
    prev: { x: number; y: number };
    next: { x: number; y: number };
  }[];
  select: string[];
}): HistoryEntry {
  const redo: Op[] = [];
  for (const move of input.moves) {
    redo.push({ op: "set", path: `nodes.${move.id}.x`, value: move.next.x, prev: move.prev.x });
    redo.push({ op: "set", path: `nodes.${move.id}.y`, value: move.next.y, prev: move.prev.y });
  }
  return createHistoryEntry({
    id: input.id,
    label: input.label ?? `移动 ${input.moves.length} 个节点`,
    redo,
    selectAfterRedo: input.select,
    selectAfterUndo: input.select,
  });
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value !== null && typeof value === "object") {
    return value as Record<string, unknown>;
  }
  return null;
}

function setAtPath(root: Record<string, unknown>, path: string, value: unknown): boolean {
  const parts = path.split(".");
  if (parts.length === 0 || parts[0] === undefined || parts[0] === "") {
    return false;
  }
  let cursor: Record<string, unknown> = root;
  for (let i = 0; i < parts.length - 1; i += 1) {
    const key = parts[i];
    if (key === undefined) {
      return false;
    }
    const next = asRecord(cursor[key]);
    if (next === null) {
      return false;
    }
    cursor = next;
  }
  const last = parts[parts.length - 1];
  if (last === undefined) {
    return false;
  }
  cursor[last] = value;
  return true;
}

export function applyOp(project: CanvasProjectFile, op: Op): boolean {
  switch (op.op) {
    case "set":
      return setAtPath(project as unknown as Record<string, unknown>, op.path, op.value);
    case "put-node":
      project.nodes[op.node.id] = structuredClone(op.node);
      return true;
    case "drop-node":
      if (project.nodes[op.id] === undefined) {
        return false;
      }
      delete project.nodes[op.id];
      return true;
    case "put-edge":
      project.edges[op.edge.id] = structuredClone(op.edge);
      return true;
    case "drop-edge":
      if (project.edges[op.id] === undefined) {
        return false;
      }
      delete project.edges[op.id];
      return true;
    case "put-group":
      project.groups[op.group.id] = structuredClone(op.group);
      return true;
    case "drop-group":
      if (project.groups[op.id] === undefined) {
        return false;
      }
      delete project.groups[op.id];
      return true;
  }
}

export function applyOps(project: CanvasProjectFile, ops: readonly Op[]): CanvasProjectFile {
  const next = structuredClone(project);
  for (const op of ops) {
    applyOp(next, op);
  }
  return next;
}

export type CommandHistoryOptions = {
  limit?: number;
  idFactory?: () => string;
};

function withOriginalPrev(redo: Op[], originalUndo: Op[]): Op[] {
  const prevByPath = new Map<string, unknown>();
  for (const op of originalUndo) {
    if (op.op === "set") {
      prevByPath.set(op.path, op.value);
    }
  }
  return redo.map((op) => {
    if (op.op !== "set") {
      return op;
    }
    const prev = prevByPath.get(op.path);
    if (prev === undefined) {
      return op;
    }
    return { op: "set", path: op.path, value: op.value, prev };
  });
}

export class CommandHistory {
  private readonly limit: number;
  private readonly idFactory: () => string;
  private past: HistoryEntry[] = [];
  private future: HistoryEntry[] = [];

  constructor(options: CommandHistoryOptions = {}) {
    this.limit = options.limit ?? HISTORY_LIMIT;
    this.idFactory = options.idFactory ?? (() => crypto.randomUUID());
  }

  push(entry: HistoryEntry): HistoryEntry {
    const withId: HistoryEntry =
      entry.id === "" ? { ...entry, id: this.idFactory() } : entry;
    const last = this.past[this.past.length - 1];
    if (
      withId.coalesceKey !== undefined &&
      last !== undefined &&
      last.coalesceKey === withId.coalesceKey
    ) {
      const merged: HistoryEntry = {
        ...withId,
        id: last.id,
        undo: last.undo,
        redo: withOriginalPrev(withId.redo, last.undo),
      };
      this.past[this.past.length - 1] = merged;
      this.future = [];
      return merged;
    }
    this.past.push(withId);
    if (this.past.length > this.limit) {
      this.past.shift();
    }
    this.future = [];
    return withId;
  }

  undo(): HistoryEntry | null {
    const entry = this.past.pop();
    if (entry === undefined) {
      return null;
    }
    this.future.push(entry);
    return entry;
  }

  redo(): HistoryEntry | null {
    const entry = this.future.pop();
    if (entry === undefined) {
      return null;
    }
    this.past.push(entry);
    return entry;
  }

  canUndo(): boolean {
    return this.past.length > 0;
  }

  canRedo(): boolean {
    return this.future.length > 0;
  }

  clear(): void {
    this.past = [];
    this.future = [];
  }

  /** 结束当前 coalesce 窗口，下一条同 key 也开新记录。 */
  seal(): void {
    const last = this.past[this.past.length - 1];
    if (last === undefined || last.coalesceKey === undefined) {
      return;
    }
    const sealed: HistoryEntry = {
      id: last.id,
      label: last.label,
      redo: last.redo,
      undo: last.undo,
      selectAfterRedo: last.selectAfterRedo,
      selectAfterUndo: last.selectAfterUndo,
    };
    this.past[this.past.length - 1] = sealed;
  }

  depth(): number {
    return this.past.length;
  }
}
