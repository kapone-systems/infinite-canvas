/**
 * 方案阶段 4 / 12.2 节可编程假执行器。
 * 只替 POST /prompt 与取图；成功字节为能过魔数并出 thumb-webp-longedge-512-v1 的真 PNG。
 * 不发外网。
 */
import { randomUUID } from "node:crypto";
import { USER_FACING } from "@canvas/schema";
import { parseFlag } from "../appData.ts";
import { encodePngRgba } from "../media/png.ts";
import type {
  ComfyExecutor,
  ComfyImage,
  ComfySubmitInput,
  ComfySubmitResult,
  ComfyUploadInput,
  ComfyUploadResult,
  ComfyWaitResult,
} from "./comfy/client.ts";

export type FakeBehavior =
  | "succeed-immediately"
  | "fail-immediately"
  | "hang-until-cancel"
  | "hang-until-release"
  | "hang-then-succeed"
  | "succeed-on-cancel"
  | "cancel-no-reply";

export const FAKE_BEHAVIORS: readonly FakeBehavior[] = [
  "succeed-immediately",
  "fail-immediately",
  "hang-until-cancel",
  "hang-until-release",
  "hang-then-succeed",
  "succeed-on-cancel",
  "cancel-no-reply",
];

/** 真实进程默认：先挂住再成功，才能演示排队、取消、跑中改字、刷新挂上。 */
export const DEFAULT_PROCESS_FAKE_BEHAVIOR: FakeBehavior = "hang-then-succeed";
export const DEFAULT_PROCESS_FAKE_DELAY_MS = 8000;

export function parseFakeExecutor(
  argv: string[],
  env: NodeJS.ProcessEnv = {},
): { behavior: FakeBehavior; delayMs: number; failAtVariantIndex: number | null } {
  const raw = parseFlag(argv, "--fake-executor") ?? env.CANVAS_FAKE_EXECUTOR ?? DEFAULT_PROCESS_FAKE_BEHAVIOR;
  const behavior = (FAKE_BEHAVIORS as readonly string[]).includes(raw)
    ? (raw as FakeBehavior)
    : DEFAULT_PROCESS_FAKE_BEHAVIOR;
  const delayRaw = parseFlag(argv, "--fake-delay-ms") ?? env.CANVAS_FAKE_DELAY_MS;
  let delayMs = DEFAULT_PROCESS_FAKE_DELAY_MS;
  if (delayRaw !== undefined) {
    const parsed = Number.parseInt(delayRaw, 10);
    if (Number.isInteger(parsed) && parsed >= 0) {
      delayMs = parsed;
    }
  }
  const failRaw = parseFlag(argv, "--fake-fail-at-variant") ?? env.CANVAS_FAKE_FAIL_AT_VARIANT;
  let failAtVariantIndex: number | null = null;
  if (failRaw !== undefined) {
    const parsed = Number.parseInt(failRaw, 10);
    if (Number.isInteger(parsed) && parsed >= 0) {
      failAtVariantIndex = parsed;
    }
  }
  return { behavior, delayMs, failAtVariantIndex };
}

export type FakeBehaviorFn = (input: ComfySubmitInput) => FakeBehavior;

export function fictionalSuccessPng(): Uint8Array {
  const encoded = encodePngRgba(8, 8, Uint8Array.from({ length: 8 * 8 * 4 }, (_, i) => (i % 4 === 3 ? 255 : 48)));
  const copy = new Uint8Array(encoded.byteLength);
  copy.set(encoded);
  return copy;
}

type Job = {
  input: ComfySubmitInput;
  behavior: FakeBehavior;
  resolveWait: ((result: ComfyWaitResult) => void) | null;
};

export class FakeExecutor implements ComfyExecutor {
  lastPromptText: string | null = null;
  readonly submitted: ComfySubmitInput[] = [];
  readonly uploaded: Array<{ name: string; bytes: Uint8Array; mime: string }> = [];
  readonly interrupted: string[] = [];
  readonly promptIds: string[] = [];
  failAtVariantIndex: number | null;
  private readonly jobs = new Map<string, Job>();
  private readonly releases = new Map<string, () => void>();
  private readonly behavior: FakeBehavior | FakeBehaviorFn;
  private readonly delayMs: number;
  private readonly image: ComfyImage;
  private seq = 0;
  private uploadSeq = 0;
  private readonly submitCountByTask = new Map<string, number>();

  constructor(
    options: {
      behavior?: FakeBehavior | FakeBehaviorFn;
      delayMs?: number;
      png?: Uint8Array;
      failAtVariantIndex?: number | null;
    } = {},
  ) {
    this.behavior = options.behavior ?? "succeed-immediately";
    this.delayMs = options.delayMs ?? DEFAULT_PROCESS_FAKE_DELAY_MS;
    this.failAtVariantIndex = options.failAtVariantIndex ?? null;
    const bytes = options.png ?? fictionalSuccessPng();
    this.image = { bytes, mime: "image/png" };
  }

  async uploadImage(input: ComfyUploadInput): Promise<ComfyUploadResult> {
    this.uploadSeq += 1;
    const name = `fake-upload-${this.uploadSeq}.png`;
    this.uploaded.push({ name, bytes: input.bytes, mime: input.mime });
    return { name };
  }

  async submit(input: ComfySubmitInput): Promise<ComfySubmitResult> {
    this.lastPromptText = input.promptText;
    this.submitted.push(input);
    this.seq += 1;
    const promptId = `fake-${this.seq}-${randomUUID()}`;
    this.promptIds.push(promptId);
    const count = this.submitCountByTask.get(input.taskId) ?? 0;
    this.submitCountByTask.set(input.taskId, count + 1);
    const index = input.variantIndex ?? count;
    let behavior = typeof this.behavior === "function" ? this.behavior(input) : this.behavior;
    if (this.failAtVariantIndex !== null && index === this.failAtVariantIndex) {
      behavior = "fail-immediately";
    }
    this.jobs.set(promptId, { input, behavior, resolveWait: null });
    return { promptId };
  }

  wait(promptId: string, signal: AbortSignal): Promise<ComfyWaitResult> {
    const job = this.jobs.get(promptId);
    if (job === undefined) {
      return Promise.resolve({
        ok: false,
        code: "failed",
        message: USER_FACING.generationIncomplete,
      });
    }
    switch (job.behavior) {
      case "succeed-immediately":
        return Promise.resolve({ ok: true, images: [this.image] });
      case "fail-immediately":
        return Promise.resolve({
          ok: false,
          code: "failed",
          message: USER_FACING.generationIncomplete,
        });
      case "hang-then-succeed":
        return this.waitThenSucceed(promptId, signal);
      case "hang-until-cancel":
        return this.waitForAbort(job, signal, {
          ok: false,
          code: "cancelled",
          message: USER_FACING.cancelledNoResult,
        });
      case "hang-until-release":
        return new Promise((resolve) => {
          const finish = (result: ComfyWaitResult): void => {
            resolve(result);
          };
          this.releases.set(promptId, () => finish({ ok: true, images: [this.image] }));
          const onAbort = (): void => {
            finish({
              ok: false,
              code: "cancelled",
              message: USER_FACING.cancelledNoResult,
            });
          };
          if (signal.aborted) {
            onAbort();
            return;
          }
          signal.addEventListener("abort", onAbort, { once: true });
          job.resolveWait = resolve;
        });
      case "succeed-on-cancel":
        return this.waitForAbort(job, signal, { ok: true, images: [this.image] });
      case "cancel-no-reply":
        return new Promise((resolve) => {
          job.resolveWait = resolve;
        });
    }
  }

  async interrupt(promptId: string): Promise<void> {
    this.interrupted.push(promptId);
    const job = this.jobs.get(promptId);
    if (job === undefined) {
      return;
    }
    if (job.behavior === "cancel-no-reply") {
      return;
    }
  }

  releaseAll(): void {
    for (const release of this.releases.values()) {
      release();
    }
    this.releases.clear();
  }

  release(promptId: string): void {
    this.releases.get(promptId)?.();
    this.releases.delete(promptId);
  }

  lastPromptId(): string | null {
    const last = this.submitted.at(-1);
    if (last === undefined) {
      return null;
    }
    for (const [promptId, job] of this.jobs) {
      if (job.input.taskId === last.taskId) {
        return promptId;
      }
    }
    return null;
  }

  private waitThenSucceed(promptId: string, signal: AbortSignal): Promise<ComfyWaitResult> {
    return new Promise((resolve) => {
      const finish = (result: ComfyWaitResult): void => {
        resolve(result);
      };
      const timer = setTimeout(() => {
        finish({ ok: true, images: [this.image] });
      }, this.delayMs);
      const onAbort = (): void => {
        clearTimeout(timer);
        finish({
          ok: false,
          code: "cancelled",
          message: USER_FACING.cancelledNoResult,
        });
      };
      if (signal.aborted) {
        onAbort();
        return;
      }
      signal.addEventListener("abort", onAbort, { once: true });
      this.releases.set(promptId, () => {
        clearTimeout(timer);
        finish({ ok: true, images: [this.image] });
      });
    });
  }

  private waitForAbort(
    job: Job,
    signal: AbortSignal,
    result: ComfyWaitResult,
  ): Promise<ComfyWaitResult> {
    return new Promise((resolve) => {
      const finish = (): void => {
        resolve(result);
      };
      if (signal.aborted) {
        finish();
        return;
      }
      signal.addEventListener("abort", finish, { once: true });
      job.resolveWait = resolve;
    });
  }
}
