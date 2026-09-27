import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { USER_FACING } from "./userFacingMessages.ts";

const here = dirname(fileURLToPath(import.meta.url));

test("阶段 4 主句是 11.1 / 12.2 原文，没有正在安排", () => {
  assert.equal(USER_FACING.emptyCanvasHintPhase3, "从左侧加上文本或生成");
  assert.equal(
    USER_FACING.emptyCanvasHintPhase4,
    "从左侧加上文本或生成，或把图片拖进来",
  );
  assert.equal(USER_FACING.handingToLocalQueue, "正在交给本机队列");
  assert.equal(USER_FACING.localQueueAhead(1), "前面还有 1 个本地任务");
  assert.equal(USER_FACING.queuedBehind(2), "前面还有 2 个本地任务");
  assert.equal(USER_FACING.localQueueAhead(1).includes("%"), false);
  assert.equal(USER_FACING.generatingLabel, "正在生成");
  assert.equal(USER_FACING.generatingElapsed("…"), "正在生成，已用时…");
  assert.equal(USER_FACING.generatingElapsed(" 12 秒").includes("%"), false);
  assert.equal(USER_FACING.missingPrompt, "还缺提示词。");
  assert.equal(USER_FACING.missingSourceImage, "还缺原图。");
  assert.equal(USER_FACING.missingReferenceImage, "还缺参考图。");
  assert.equal(USER_FACING.slotUnsupportedMask, "这张配方还不能用遮罩。");
  assert.equal(
    USER_FACING.retryFailedInputsChanged,
    "输入已经变了，不能只补失败的那几张。请重新运行这个节点。",
  );
  assert.equal(USER_FACING.retryFailed, "只补失败的");
  assert.equal(USER_FACING.upstreamNotRun, "上游没成功，这一步没跑。");
  assert.equal(USER_FACING.partialSuccess(4, 2), "4 张里成功了 2 张。");
  assert.equal(USER_FACING.selectionPartial(3, 1), "3 个里有 1 个失败");
  assert.equal(USER_FACING.runUsesStaleUpstream, "将用上游当前的过期结果运行 1 个节点。");
  assert.equal(USER_FACING.runSkippedFresh, "当前结果还没过期，这次跳过。");
  assert.equal(USER_FACING.runDownstreamOriginNotRerun, "这次不会重跑当前节点。");
  assert.equal(USER_FACING.variantCountLabel, "变体张数");
  assert.equal(USER_FACING.comfyUnconfigured, "还没有填写本机 ComfyUI 地址。");
  assert.equal(
    USER_FACING.comfyUnreachable,
    "连不上本机 ComfyUI。请确认它已启动，并且后端配置的地址可达。",
  );
  assert.equal(USER_FACING.cancelling, "正在取消");
  assert.equal(USER_FACING.cancelledNoResult, "已取消，没有新结果");
  assert.equal(USER_FACING.tooLateToCancel, "来不及取消，结果已经完成");
  assert.equal(USER_FACING.cancelUncertain, "取消结果不确定");
  assert.equal(USER_FACING.generationIncomplete, "生成没有完成");
  assert.equal(
    USER_FACING.inputsChangedAfterRun,
    "跑完的时候输入已经变了，这张图已标成过期。",
  );
  assert.equal(
    USER_FACING.inputsChangedWhileRunning,
    "跑完的时候输入已经变了，这张图已标成过期。",
  );
  assert.equal(USER_FACING.alreadyRunning, "这个节点已经在跑。");
  assert.equal(USER_FACING.ingestFailed, "这张图没能放进媒体库。");
  assert.equal(USER_FACING.ingestSvg, "第一版不接收 SVG。");
  assert.equal(USER_FACING.svgRejected, "第一版不接收 SVG。");
  assert.equal(USER_FACING.ingestTooLarge, "单个文件超过 2 GiB，第一版不接收。");
  assert.equal(USER_FACING.fileTooLarge, "单个文件超过 2 GiB，第一版不接收。");
  assert.equal(USER_FACING.thumbPartial, "缩略图没加载出来");
  assert.equal(USER_FACING.recipeNotFound, "找不到这张配方。");
  assert.equal(
    USER_FACING.recipeUiFormat,
    "这是 ComfyUI 的界面格式。本应用只接受 API 格式，并且要包在我们自己的配方里。",
  );
  assert.equal(
    USER_FACING.recipeBarePrompt,
    "请把 API 格式工作流放进配方的 comfy.prompt，不要单独导入一张工作流。",
  );
  assert.equal(USER_FACING.comfyRejected, "ComfyUI 拒绝了这次提交。");
  assert.equal(USER_FACING.comfyFailed, "ComfyUI 执行失败。");
  assert.equal(USER_FACING.comfyNoImage, "ComfyUI 说完成了，但没有返回图片。");
  const source = readFileSync(join(here, "userFacingMessages.ts"), "utf8");
  assert.equal(source.includes("正在安排"), false);
  assert.equal(source.includes("KSampler"), false);
  assert.equal(source.includes("VAE"), false);
  assert.equal(source.includes("CLIP"), false);
  assert.equal(source.includes("Load Checkpoint"), false);
});

test("阶段 6 缺失与损坏句用方案原文，太新太旧和自动保存失败句不改字", () => {
  assert.equal(USER_FACING.mediaMissing, "找不到原来的媒体文件");
  assert.equal(USER_FACING.openedFromBackup, "工程文件损坏，已打开上一份备份。");
  assert.equal(
    USER_FACING.projectCorruptNoBackup,
    "工程文件损坏，而且没有可用的备份。文件还留在原地。",
  );
  assert.equal(USER_FACING.schemaVersionNewer, "这份工程是更新的版本写的，画布没有打开它，以免写坏。");
  assert.equal(USER_FACING.schemaVersionUnsupported, "还不能打开这个版本的工程。");
  assert.equal(USER_FACING.autosaveFailed, "自动保存失败，当前修改还在这个页面上。");
  assert.equal(USER_FACING.restoredFromAutosave, "已从自动保存恢复。");
});
