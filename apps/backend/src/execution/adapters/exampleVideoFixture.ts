/**
 * 方案第 9.5 节 CloudVideoAdapter。
 * 夹具不 fetch、不读密钥。download 的字节是适配器自己的，不是媒体库原件。
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { USER_FACING, type CloudVideoConstraints, type SlotRole } from "@canvas/schema";

export type CloudSubmitInput = {
  taskId: string;
  slots: Array<{ role: SlotRole; order: number; fromNodeId: string; text?: string; contentHash?: string }>;
  params: Record<string, string | number | boolean | null>;
  files: Array<{ role: SlotRole; order: number; mime: string; bytes: Uint8Array }>;
};

export type CloudPollResult =
  | { state: "queued" | "running" }
  | { state: "succeeded" }
  | { state: "failed"; message: string };

export type CloudCancelResult = "cancelled" | "unsupported" | "already-finished";

/** 重启对账。夹具同步返回，不打外网。未实现则不能证明仍在跑。 */
export type CloudJobInspect =
  | { kind: "queued" | "running" }
  | { kind: "succeeded"; bytes: Uint8Array; mime: string }
  | { kind: "missing" }
  | { kind: "unreachable" };

export type CloudSecret = { providerId: string; bytes?: Uint8Array };

export interface CloudVideoAdapter {
  id: string;
  kind: "video.generate";
  profileId: "img2video";
  constraints: CloudVideoConstraints;
  submit(input: CloudSubmitInput, secret: CloudSecret): Promise<{ providerJobId: string }>;
  poll(providerJobId: string, secret: CloudSecret): Promise<CloudPollResult>;
  cancel(providerJobId: string, secret: CloudSecret): Promise<CloudCancelResult>;
  download(providerJobId: string, secret: CloudSecret): Promise<{ bytes: Uint8Array; mime: string }>;
  inspect?(providerJobId: string): CloudJobInspect;
}

/**
 * 64×64、约 1 秒的黑场 H.264。能被 ffmpeg 解码，不是厂商样片。
 * 只有 ftyp 头时抽不出帧，夹具会永远停在 partial。
 */
export const FIXTURE_VIDEO_BYTES = new Uint8Array(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), "fixture-clip.mp4")),
);

const FIXTURE_CONSTRAINTS: CloudVideoConstraints = {
  upload: "multipart",
  firstFrame: "required",
  lastFrame: "optional",
  referenceImageCount: { min: 0, max: 0 },
  duration: { unit: "seconds", allowed: [2, 4, 8] },
  pollIntervalMs: 2000,
  pollTimeoutMs: 600000,
};

export type FixtureVideoControls = {
  submitCount: number;
  pollCount: number;
  cancelCount: number;
  downloadCount: number;
  lastFiles: Uint8Array[];
  /** 为 true 时 poll 停在未兑现的 Promise 上，直到 releasePoll。 */
  hangPoll: boolean;
  releasePoll: () => void;
  cancelResult: CloudCancelResult;
  bytes: Uint8Array;
};

export type FixtureVideoAdapter = CloudVideoAdapter & { controls: FixtureVideoControls };

export function createFixtureVideoAdapter(initial?: Partial<Pick<FixtureVideoControls, "hangPoll" | "cancelResult" | "bytes">>): FixtureVideoAdapter {
  let release: (() => void) | null = null;
  const controls: FixtureVideoControls = {
    submitCount: 0,
    pollCount: 0,
    cancelCount: 0,
    downloadCount: 0,
    lastFiles: [],
    hangPoll: initial?.hangPoll === true,
    releasePoll: () => {
      release?.();
      release = null;
    },
    cancelResult: initial?.cancelResult ?? "cancelled",
    bytes: initial?.bytes ?? FIXTURE_VIDEO_BYTES,
  };
  return {
    id: "example.video.fixture",
    kind: "video.generate",
    profileId: "img2video",
    constraints: FIXTURE_CONSTRAINTS,
    controls,
    async submit(input) {
      controls.submitCount += 1;
      controls.lastFiles = input.files.map((file) => Uint8Array.from(file.bytes));
      return { providerJobId: `fixture-${input.taskId}` };
    },
    poll() {
      controls.pollCount += 1;
      if (controls.hangPoll) {
        return new Promise((resolve) => {
          release = () => {
            controls.hangPoll = false;
            resolve({ state: "succeeded" });
          };
        });
      }
      return Promise.resolve({ state: "succeeded" });
    },
    async cancel() {
      controls.cancelCount += 1;
      return controls.cancelResult;
    },
    async download() {
      controls.downloadCount += 1;
      return { bytes: Uint8Array.from(controls.bytes), mime: "video/mp4" };
    },
  };
}

export type NeedsSecretAdapter = CloudVideoAdapter & { submitCount: number };

export function createNeedsSecretAdapter(): NeedsSecretAdapter {
  const adapter = {
    id: "example.video.needs-secret",
    kind: "video.generate" as const,
    profileId: "img2video" as const,
    constraints: FIXTURE_CONSTRAINTS,
    submitCount: 0,
    async submit(input: CloudSubmitInput) {
      adapter.submitCount += 1;
      return { providerJobId: `needs-secret-${input.taskId}` };
    },
    async poll(): Promise<CloudPollResult> {
      return { state: "failed", message: USER_FACING.generationFailedNoDetail };
    },
    async cancel(): Promise<CloudCancelResult> {
      return "cancelled";
    },
    async download() {
      return { bytes: Uint8Array.from(FIXTURE_VIDEO_BYTES), mime: "video/mp4" };
    },
  };
  return adapter;
}
