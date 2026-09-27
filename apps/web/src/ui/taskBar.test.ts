import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { USER_FACING } from "@canvas/schema";
import {
  foldRunningDetails,
  inspectorErrorLines,
  RUNNING_DETAIL_LIMIT,
  runningDetailsFromNodes,
  type RunningDetail,
} from "./taskBar.ts";

const inspectorSrc = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "Inspector.tsx"), "utf8");

test("9 条云端明细展开 8 条，本地另算一段", () => {
  assert.equal(RUNNING_DETAIL_LIMIT, 8);
  const cloud: RunningDetail[] = Array.from({ length: 9 }, (_, index) => ({
    id: `c${index}`,
    lane: "cloud",
    label: `云端 ${index}`,
  }));
  const local: RunningDetail[] = [{ id: "l1", lane: "local", label: "本地 1" }];
  const folded = foldRunningDetails([...local, ...cloud]);
  assert.equal(folded.cloud.shown.length, 8);
  assert.equal(folded.cloud.hidden, 1);
  assert.equal(folded.local.shown.length, 1);
  assert.equal(folded.local.hidden, 0);
  assert.equal(USER_FACING.moreRunning(folded.cloud.hidden), "另有 1 个在运行");
  assert.equal(folded.cloud.shown.some((row) => row.lane === "local"), false);
  assert.equal(folded.local.shown.some((row) => row.lane === "cloud"), false);
});

test("运行中的节点按 runner 分成两段，过期成功不算在跑", () => {
  const details = runningDetailsFromNodes([
    { id: "a", kind: "generation", title: "文生图", phase: "running", runner: "local", progress: { ratio: null, label: "正在交给本机队列" } },
    { id: "b", kind: "generation", title: "图生视频", phase: "queued", runner: "cloud", progress: { ratio: null, label: "正在生成" } },
    { id: "c", kind: "generation", title: "过期", phase: "succeeded", runner: "local", progress: null },
    { id: "d", kind: "text", title: "文本", phase: "idle", runner: null, progress: null },
  ]);
  const folded = foldRunningDetails(details);
  assert.equal(folded.local.shown.length, 1);
  assert.equal(folded.cloud.shown.length, 1);
  assert.equal(folded.local.shown[0]?.id, "a");
  assert.equal(folded.cloud.shown[0]?.id, "b");
});

test("检查器任务条两段标题，次句从 lastError.detail 画出", () => {
  assert.equal(inspectorSrc.includes('data-task-lane={props.lane}'), true);
  assert.equal(inspectorSrc.includes('title="本地"'), true);
  assert.equal(inspectorSrc.includes('title="云端"'), true);
  assert.equal(inspectorSrc.includes("COPY.moreRunning"), true);
  assert.equal(inspectorSrc.includes("data-error-detail"), true);
  assert.equal(inspectorSrc.includes("foldRunningDetails"), true);
  assert.equal(inspectorSrc.includes("正在核对上次没跑完的任务"), false);
  assert.equal(inspectorSrc.includes("重启后没能对上上次的任务"), false);
  const stopped = inspectorErrorLines({
    message: USER_FACING.stoppedWaiting,
    detail: USER_FACING.cloudCancelMayFinish,
  });
  assert.equal(stopped?.message, "已停止在这里等待");
  assert.equal(stopped?.detail, "对方可能仍会完成，本应用不再接收那次结果。");
  const restart = inspectorErrorLines({
    message: USER_FACING.restartUncertain,
    detail: USER_FACING.resumeHint,
  });
  assert.equal(restart?.message, "本机服务重启过，这个任务的结果不确定。");
  assert.equal(restart?.detail, "可以重新运行或续跑。");
});
