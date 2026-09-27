import type { Camera, CanvasProjectFile, ProjectNode } from "@canvas/schema";
import { mergeWorkingCopy } from "@canvas/schema";
import type { MergeWorkingCopyResult } from "@canvas/schema";
import { USER_FACING } from "../messages.ts";
import { writeAutosave, type AutosaveResult } from "./autosave.ts";
import { serializeProjectFile } from "./atomicWrite.ts";

export const AUTOSAVE_DELAY_MS = 1000;

export type OpenedProject = {
  absolutePath: string;
  project: CanvasProjectFile;
  openedDiskContentRevision: number;
  restoredFromAutosave: boolean;
  /** 打开结果要给界面的句子。自动保存恢复仍走 restoredFromAutosave。 */
  openMessage?: string | null;
};

export function isDirty(project: CanvasProjectFile): boolean {
  return project.contentRevision !== project.savedContentRevision;
}

export function projectForDisk(project: CanvasProjectFile): CanvasProjectFile {
  return serializeProjectFile(project);
}

export class ProjectSession {
  current: OpenedProject | null = null;
  lastAutosaveError: string | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly now: () => Date;
  readonly autosaveDelayMs: number;

  constructor(options: { now?: () => Date; autosaveDelayMs?: number } = {}) {
    this.now = options.now ?? (() => new Date());
    this.autosaveDelayMs = options.autosaveDelayMs ?? AUTOSAVE_DELAY_MS;
  }

  timestamp(): Date {
    return this.now();
  }

  isDirty(): boolean {
    return this.current !== null && isDirty(this.current.project);
  }

  setCurrent(opened: OpenedProject): void {
    this.cancelAutosaveTimer();
    this.lastAutosaveError = null;
    this.current = opened;
  }

  clear(): void {
    this.cancelAutosaveTimer();
    this.current = null;
    this.lastAutosaveError = null;
  }

  cancelAutosaveTimer(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  scheduleAutosave(): void {
    this.cancelAutosaveTimer();
    if (this.current === null) {
      return;
    }
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flushAutosave();
    }, this.autosaveDelayMs);
    this.timer.unref();
  }

  async flushAutosave(): Promise<AutosaveResult | null> {
    this.cancelAutosaveTimer();
    if (this.current === null) {
      return null;
    }
    const result = await writeAutosave(this.current.absolutePath, this.current.project);
    if (result.ok) {
      this.lastAutosaveError = null;
    } else {
      this.lastAutosaveError = result.message;
    }
    return result;
  }

  applyWorkingCopy(body: unknown): MergeWorkingCopyResult {
    if (this.current === null) {
      return {
        ok: false,
        httpStatus: 400,
        code: "invalid_project",
        message: USER_FACING.workingCopySyncFailed,
      };
    }
    const result = mergeWorkingCopy(this.current.project, body, { now: this.now() });
    if (!result.ok) {
      return result;
    }
    this.current.project = result.project;
    this.scheduleAutosave();
    return result;
  }

  setViewport(camera: Camera): void {
    if (this.current === null) {
      return;
    }
    this.current.project = {
      ...this.current.project,
      viewport: camera,
    };
  }

  executionRevisions(): Record<string, number> {
    if (this.current === null) {
      return {};
    }
    const revisions: Record<string, number> = {};
    for (const [id, node] of Object.entries(this.current.project.nodes) as Array<[string, ProjectNode]>) {
      revisions[id] = node.executionRevision ?? 0;
    }
    return revisions;
  }

  /**
   * 执行器写工作副本。禁止走 applyWorkingCopy（1s 防抖合并）。
   * 补丁不含 x/y/width/z；height 可由调用方写入。
   */
  applyExecutionPatch(
    nodeId: string,
    patch: Partial<ProjectNode>,
    options: { bumpContentRevision: boolean },
  ): { node: ProjectNode; contentRevision: number; executionRevision: number } | null {
    if (this.current === null) {
      return null;
    }
    const prev = this.current.project.nodes[nodeId];
    if (prev === undefined) {
      return null;
    }
    const safe: Partial<ProjectNode> = { ...patch };
    delete safe.x;
    delete safe.y;
    delete safe.width;
    delete safe.z;
    const nowIso = this.now().toISOString();
    const next: ProjectNode = {
      ...prev,
      ...safe,
      id: prev.id,
      executionRevision: (prev.executionRevision ?? 0) + 1,
      updatedAt: nowIso,
    };
    this.current.project.nodes[nodeId] = next;
    if (options.bumpContentRevision) {
      this.current.project.contentRevision += 1;
    }
    this.current.project.updatedAt = nowIso;
    return {
      node: next,
      contentRevision: this.current.project.contentRevision,
      executionRevision: next.executionRevision ?? 0,
    };
  }
}

export function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function parseCamera(body: unknown): Camera | null {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return null;
  }
  const record = body as Record<string, unknown>;
  if (!isFiniteNumber(record.x) || !isFiniteNumber(record.y) || !isFiniteNumber(record.zoom)) {
    return null;
  }
  return { x: record.x, y: record.y, zoom: record.zoom };
}
