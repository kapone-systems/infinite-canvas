/**
 * 方案第 1.3 / 9.6 节任务库。
 * 文件在 dataDir/execution.sqlite（生产即 %LOCALAPPDATA%\CanvasApp\execution.sqlite）。
 * 不进工程目录。测试必须传入隔离 dataDir。
 * 表 runs / tasks / variants / events；状态变化同一事务。
 * 本文件不调度、不接 Comfy。
 */

import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  RUN_STATES,
  TASK_STATES,
  type RunEvent,
  type RunPlan,
  type RunScope,
  type RunSnapshot,
  type RunState,
  type TaskLane,
  type TaskRecord,
  type TaskState,
  type UserFacingError,
} from "@canvas/schema";

export const EXECUTION_DB_FILENAME = "execution.sqlite" as const;

export function executionSqlitePath(dataDir: string): string {
  return join(resolve(dataDir), EXECUTION_DB_FILENAME);
}

export class TaskStoreError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "TaskStoreError";
  }
}

export type InsertQueuedTask = {
  taskId: string;
  nodeId: string;
  lane: TaskLane;
  recipeId: string;
  recipeVersion: number;
  fingerprintAtStart: string;
  variants?: TaskRecord["variants"];
  error?: UserFacingError | null;
};

export type InsertQueuedInput = {
  runId: string;
  projectId: string;
  clientRequestId: string;
  scope: RunScope;
  force: boolean;
  plan: RunPlan;
  summary: string;
  tasks: InsertQueuedTask[];
  events?: RunEvent[];
  now?: string;
};

export type TaskPatch = {
  taskId: string;
  state: TaskState;
  error?: UserFacingError | null;
  variants?: TaskRecord["variants"];
};

export type ApplyChangesInput = {
  tasks?: TaskPatch[];
  run?: { runId: string; state: RunState; summary?: string };
  events?: RunEvent[];
  now?: string;
};

type RunRow = {
  run_id: string;
  project_id: string;
  client_request_id: string;
  scope_json: string;
  force: number;
  state: string;
  plan_json: string;
  summary: string;
  created_at: string;
  updated_at: string;
};

type TaskRow = {
  task_id: string;
  run_id: string;
  project_id: string;
  node_id: string;
  lane: string;
  recipe_id: string;
  recipe_version: number;
  state: string;
  fingerprint_at_start: string;
  error_json: string | null;
  created_at: string;
  updated_at: string;
};

type VariantRow = {
  task_id: string;
  variant_index: number;
  state: string;
  seed_used: number | null;
  outputs_json: string;
  error_json: string | null;
  provider_job_id: string | null;
};

type EventRow = {
  payload_json: string;
};

const SCHEMA_SQL = `
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS runs (
  run_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  client_request_id TEXT NOT NULL,
  scope_json TEXT NOT NULL,
  force INTEGER NOT NULL CHECK (force IN (0, 1)),
  state TEXT NOT NULL CHECK (state IN ('running','succeeded','partial','failed','cancelled')),
  plan_json TEXT NOT NULL,
  summary TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS runs_project_client_request
  ON runs (project_id, client_request_id);
CREATE TABLE IF NOT EXISTS tasks (
  task_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(run_id),
  project_id TEXT NOT NULL,
  node_id TEXT NOT NULL,
  lane TEXT NOT NULL CHECK (lane IN ('local','cloud')),
  recipe_id TEXT NOT NULL,
  recipe_version INTEGER NOT NULL,
  state TEXT NOT NULL CHECK (state IN (
    'queued','submitted','running','succeeded','partial','failed','cancelled','interrupted'
  )),
  fingerprint_at_start TEXT NOT NULL,
  error_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS tasks_run_id ON tasks (run_id);
CREATE TABLE IF NOT EXISTS variants (
  task_id TEXT NOT NULL REFERENCES tasks(task_id),
  variant_index INTEGER NOT NULL,
  state TEXT NOT NULL,
  seed_used INTEGER,
  outputs_json TEXT NOT NULL,
  error_json TEXT,
  provider_job_id TEXT,
  PRIMARY KEY (task_id, variant_index)
);
CREATE TABLE IF NOT EXISTS events (
  event_id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT REFERENCES runs(run_id),
  seq INTEGER NOT NULL,
  type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS events_run_seq ON events (run_id, seq);
`;

const RUN_STATE_SET: ReadonlySet<string> = new Set(RUN_STATES);
const TASK_STATE_SET: ReadonlySet<string> = new Set(TASK_STATES);

function isRunState(value: string): value is RunState {
  return RUN_STATE_SET.has(value);
}

function isTaskState(value: string): value is TaskState {
  return TASK_STATE_SET.has(value);
}

function isoNow(now?: string): string {
  return now ?? new Date().toISOString();
}

function parseJson<T>(raw: string, label: string): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new TaskStoreError("CORRUPT", `${label} 不是合法 JSON`);
  }
}

function errorToSql(error: UserFacingError | null | undefined): string | null {
  if (error === null || error === undefined) {
    return null;
  }
  return JSON.stringify(error);
}

function errorFromSql(raw: string | null): UserFacingError | null {
  if (raw === null) {
    return null;
  }
  return parseJson<UserFacingError>(raw, "error");
}

export class TaskStore {
  readonly dataDir: string;
  readonly sqlitePath: string;
  private readonly db: DatabaseSync;
  private closed = false;

  private constructor(dataDir: string, sqlitePath: string, db: DatabaseSync) {
    this.dataDir = dataDir;
    this.sqlitePath = sqlitePath;
    this.db = db;
  }

  static open(dataDir: string): TaskStore {
    const resolvedDir = resolve(dataDir);
    mkdirSync(resolvedDir, { recursive: true });
    const sqlitePath = executionSqlitePath(resolvedDir);
    const db = new DatabaseSync(sqlitePath, {
      enableForeignKeyConstraints: true,
      timeout: 5000,
    });
    // DELETE 而非 WAL：Windows 上测试 kill 子进程后 rm dataDir 不会被 -wal/-shm 锁住。
    db.exec("PRAGMA journal_mode = DELETE;");
    db.exec("PRAGMA foreign_keys = ON;");
    db.exec(SCHEMA_SQL);
    return new TaskStore(resolvedDir, sqlitePath, db);
  }

  close(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    if (!this.db.isOpen) {
      return;
    }
    try {
      if (this.db.isTransaction) {
        this.db.exec("ROLLBACK");
      }
    } catch {
      /* close 仍要关掉句柄 */
    }
    this.db.close();
  }

  insertQueued(input: InsertQueuedInput): RunSnapshot {
    this.assertOpen();
    if (input.tasks.length === 0) {
      throw new TaskStoreError("INVALID", "insertQueued 至少要有一个任务");
    }
    const now = isoNow(input.now);
    return this.withTransaction(() => {
      const existingId = this.selectRunIdByClientRequest(input.projectId, input.clientRequestId);
      if (existingId !== undefined) {
        const existing = this.loadRun(existingId);
        if (existing === null) {
          throw new TaskStoreError("CORRUPT", "clientRequestId 有行但读不出 run");
        }
        return existing;
      }
      this.db
        .prepare(
          `INSERT INTO runs (
            run_id, project_id, client_request_id, scope_json, force, state, plan_json, summary, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, 'running', ?, ?, ?, ?)`,
        )
        .run(
          input.runId,
          input.projectId,
          input.clientRequestId,
          JSON.stringify(input.scope),
          input.force ? 1 : 0,
          JSON.stringify(input.plan),
          input.summary,
          now,
          now,
        );
      const insertTask = this.db.prepare(
        `INSERT INTO tasks (
          task_id, run_id, project_id, node_id, lane, recipe_id, recipe_version, state,
          fingerprint_at_start, error_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?, ?, ?)`,
      );
      for (const task of input.tasks) {
        insertTask.run(
          task.taskId,
          input.runId,
          input.projectId,
          task.nodeId,
          task.lane,
          task.recipeId,
          task.recipeVersion,
          task.fingerprintAtStart,
          errorToSql(task.error ?? null),
          now,
          now,
        );
        this.replaceVariants(task.taskId, task.variants ?? []);
      }
      const events =
        input.events ??
        ([
          { type: "run.planned", runId: input.runId, plan: input.plan },
          ...input.tasks.map((task) => ({
            type: "task.queued" as const,
            runId: input.runId,
            taskId: task.taskId,
            nodeId: task.nodeId,
          })),
        ] satisfies RunEvent[]);
      this.insertEvents(events, now);
      const snapshot = this.loadRun(input.runId);
      if (snapshot === null) {
        throw new TaskStoreError("CORRUPT", "刚插入的 run 读不出");
      }
      return snapshot;
    });
  }

  applyChanges(input: ApplyChangesInput): RunSnapshot {
    this.assertOpen();
    const patches = input.tasks ?? [];
    if (patches.length === 0 && input.run === undefined && (input.events === undefined || input.events.length === 0)) {
      throw new TaskStoreError("INVALID", "applyChanges 没有要写的内容");
    }
    const now = isoNow(input.now);
    return this.withTransaction(() => {
      let runId = input.run?.runId;
      for (const patch of patches) {
        if (!isTaskState(patch.state)) {
          throw new TaskStoreError("INVALID_STATE", `非法任务状态 ${patch.state}`);
        }
        const row = this.selectTaskRow(patch.taskId);
        if (row === undefined) {
          throw new TaskStoreError("NOT_FOUND", `task not found: ${patch.taskId}`);
        }
        runId = runId ?? row.run_id;
        const errorJson = patch.error === undefined ? row.error_json : errorToSql(patch.error);
        this.db
          .prepare(`UPDATE tasks SET state = ?, error_json = ?, updated_at = ? WHERE task_id = ?`)
          .run(patch.state, errorJson, now, patch.taskId);
        if (patch.variants !== undefined) {
          this.replaceVariants(patch.taskId, patch.variants);
        }
      }
      if (input.run !== undefined) {
        if (!isRunState(input.run.state)) {
          throw new TaskStoreError("INVALID_STATE", `非法运行状态 ${input.run.state}`);
        }
        const runRow = this.selectRunRow(input.run.runId);
        if (runRow === undefined) {
          throw new TaskStoreError("NOT_FOUND", `run not found: ${input.run.runId}`);
        }
        const summary = input.run.summary ?? runRow.summary;
        this.db
          .prepare(`UPDATE runs SET state = ?, summary = ?, updated_at = ? WHERE run_id = ?`)
          .run(input.run.state, summary, now, input.run.runId);
        runId = input.run.runId;
      }
      if (input.events !== undefined && input.events.length > 0) {
        this.insertEvents(input.events, now);
        if (runId === undefined) {
          for (const event of input.events) {
            const fromEvent = eventRunId(event);
            if (fromEvent !== null) {
              runId = fromEvent;
              break;
            }
          }
        }
      }
      if (runId === undefined) {
        throw new TaskStoreError("INVALID", "applyChanges 无法确定 runId");
      }
      this.db.prepare(`UPDATE runs SET updated_at = ? WHERE run_id = ?`).run(now, runId);
      const snapshot = this.loadRun(runId);
      if (snapshot === null) {
        throw new TaskStoreError("CORRUPT", "更新后的 run 读不出");
      }
      return snapshot;
    });
  }

  getRun(runId: string): RunSnapshot | null {
    this.assertOpen();
    return this.loadRun(runId);
  }

  getTask(taskId: string): TaskRecord | null {
    this.assertOpen();
    const row = this.selectTaskRow(taskId);
    if (row === undefined) {
      return null;
    }
    return this.taskFromRow(row);
  }

  getRunByClientRequestId(projectId: string, clientRequestId: string): RunSnapshot | null {
    this.assertOpen();
    const runId = this.selectRunIdByClientRequest(projectId, clientRequestId);
    if (runId === undefined) {
      return null;
    }
    return this.loadRun(runId);
  }

  listEvents(runId: string): RunEvent[] {
    this.assertOpen();
    const rows = this.db
      .prepare(`SELECT payload_json FROM events WHERE run_id = ? ORDER BY seq ASC, event_id ASC`)
      .all(runId) as EventRow[];
    return rows.map((row) => parseJson<RunEvent>(row.payload_json, "event"));
  }

  listTasks(options?: { lane?: TaskLane; states?: readonly TaskState[] }): TaskRecord[] {
    this.assertOpen();
    const rows = this.db
      .prepare(`SELECT * FROM tasks ORDER BY created_at ASC, task_id ASC`)
      .all() as TaskRow[];
    let tasks = rows.map((row) => this.taskFromRow(row));
    if (options?.lane !== undefined) {
      tasks = tasks.filter((task) => task.lane === options.lane);
    }
    if (options?.states !== undefined) {
      const allowed = new Set(options.states);
      tasks = tasks.filter((task) => allowed.has(task.state));
    }
    return tasks;
  }

  localActive(): TaskRecord[] {
    return this.listTasks({
      lane: "local",
      states: ["queued", "submitted", "running"],
    });
  }

  localAheadCount(taskId: string): number {
    const active = this.localActive();
    const index = active.findIndex((task) => task.taskId === taskId);
    if (index <= 0) {
      return 0;
    }
    return index;
  }

  private assertOpen(): void {
    if (this.closed || !this.db.isOpen) {
      throw new TaskStoreError("CLOSED", "任务库已关闭");
    }
  }

  private withTransaction<T>(fn: () => T): T {
    if (this.db.isTransaction) {
      return fn();
    }
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = fn();
      this.db.exec("COMMIT");
      return result;
    } catch (err) {
      try {
        this.db.exec("ROLLBACK");
      } catch {
        /* ignore */
      }
      throw err;
    }
  }

  private selectRunIdByClientRequest(projectId: string, clientRequestId: string): string | undefined {
    const row = this.db
      .prepare(`SELECT run_id FROM runs WHERE project_id = ? AND client_request_id = ?`)
      .get(projectId, clientRequestId) as { run_id: string } | undefined;
    return row?.run_id;
  }

  private selectRunRow(runId: string): RunRow | undefined {
    return this.db.prepare(`SELECT * FROM runs WHERE run_id = ?`).get(runId) as RunRow | undefined;
  }

  private selectTaskRow(taskId: string): TaskRow | undefined {
    return this.db.prepare(`SELECT * FROM tasks WHERE task_id = ?`).get(taskId) as TaskRow | undefined;
  }

  private loadRun(runId: string): RunSnapshot | null {
    const row = this.selectRunRow(runId);
    if (row === undefined) {
      return null;
    }
    if (!isRunState(row.state)) {
      throw new TaskStoreError("CORRUPT", `runs.state 非法: ${row.state}`);
    }
    const taskRows = this.db
      .prepare(`SELECT * FROM tasks WHERE run_id = ? ORDER BY created_at ASC, task_id ASC`)
      .all(runId) as TaskRow[];
    return {
      runId: row.run_id,
      projectId: row.project_id,
      scope: parseJson<RunScope>(row.scope_json, "scope"),
      force: row.force !== 0,
      state: row.state,
      plan: parseJson<RunPlan>(row.plan_json, "plan"),
      tasks: taskRows.map((taskRow) => this.taskFromRow(taskRow)),
      summary: row.summary,
    };
  }

  private taskFromRow(row: TaskRow): TaskRecord {
    if (!isTaskState(row.state)) {
      throw new TaskStoreError("CORRUPT", `tasks.state 非法: ${row.state}`);
    }
    const variantRows = this.db
      .prepare(`SELECT * FROM variants WHERE task_id = ? ORDER BY variant_index ASC`)
      .all(row.task_id) as VariantRow[];
    return {
      taskId: row.task_id,
      runId: row.run_id,
      projectId: row.project_id,
      nodeId: row.node_id,
      lane: row.lane as TaskLane,
      recipeId: row.recipe_id,
      recipeVersion: row.recipe_version,
      state: row.state,
      fingerprintAtStart: row.fingerprint_at_start,
      variants: variantRows.map((variant) => ({
        index: variant.variant_index,
        state: variant.state,
        seedUsed: variant.seed_used,
        outputs: parseJson<TaskRecord["variants"][number]["outputs"]>(variant.outputs_json, "outputs"),
        error: errorFromSql(variant.error_json),
        providerJobId: variant.provider_job_id,
      })),
      error: errorFromSql(row.error_json),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private replaceVariants(taskId: string, variants: TaskRecord["variants"]): void {
    this.db.prepare(`DELETE FROM variants WHERE task_id = ?`).run(taskId);
    const insert = this.db.prepare(
      `INSERT INTO variants (
        task_id, variant_index, state, seed_used, outputs_json, error_json, provider_job_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const variant of variants) {
      insert.run(
        taskId,
        variant.index,
        variant.state,
        variant.seedUsed,
        JSON.stringify(variant.outputs),
        errorToSql(variant.error),
        variant.providerJobId,
      );
    }
  }

  private insertEvents(events: RunEvent[], now: string): void {
    const insert = this.db.prepare(
      `INSERT INTO events (run_id, seq, type, payload_json, created_at) VALUES (?, ?, ?, ?, ?)`,
    );
    for (const event of events) {
      const runId = eventRunId(event);
      const seq = this.nextSeq(runId);
      insert.run(runId, seq, event.type, JSON.stringify(event), now);
    }
  }

  private nextSeq(runId: string | null): number {
    const row =
      runId === null
        ? (this.db.prepare(`SELECT COALESCE(MAX(seq), 0) AS seq FROM events WHERE run_id IS NULL`).get() as
            | { seq: number }
            | undefined)
        : (this.db.prepare(`SELECT COALESCE(MAX(seq), 0) AS seq FROM events WHERE run_id = ?`).get(runId) as
            | { seq: number }
            | undefined);
    return (row?.seq ?? 0) + 1;
  }
}

function eventRunId(event: RunEvent): string | null {
  return event.runId;
}

export function openTaskStore(dataDir: string): TaskStore {
  return TaskStore.open(dataDir);
}
