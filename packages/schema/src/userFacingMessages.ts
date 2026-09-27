/**
 * 方案第 11.1 节与阶段 1 / 3 / 4 / 5 空状态、连线、徽章、执行主句。
 * 前后端都从这里取，不要各写一套。进度主句只用交给本机队列。
 */

import type { MediaKind, SlotRole } from "./types.ts";

function formatLocalQueueAhead(n: number): string {
  return `前面还有 ${n} 个本地任务`;
}

function formatGeneratingElapsed(elapsed: string): string {
  return `正在生成，已用时${elapsed}`;
}

function formatParamOutOfRange(label: string, min: number, max: number): string {
  return `${label}要在 ${min} 和 ${max} 之间。`;
}

function formatPartialSuccess(n: number, m: number): string {
  return `${n} 张里成功了 ${m} 张。`;
}

function formatSelectionPartial(n: number, f: number): string {
  return `${n} 个里有 ${f} 个失败`;
}

function formatCloudHeartbeat(seconds: number): string {
  const n = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  return `云端还在处理，上次有回应是 ${n} 秒前`;
}

function formatMoreRunning(count: number): string {
  const n = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
  return `另有 ${n} 个在运行`;
}

export const SLOT_ROLE_LABELS = {
  prompt: "提示词",
  source_image: "原图",
  reference_image: "参考图",
  style_reference: "风格参考",
  character_reference: "角色参考",
  mask: "遮罩",
  first_frame: "首帧",
  last_frame: "尾帧",
  audio_reference: "音频参考",
} as const satisfies Record<SlotRole, string>;

export const MEDIA_KIND_LABELS = {
  text: "文本",
  image: "图片",
  video: "视频",
  audio: "音频",
} as const satisfies Record<MediaKind, string>;

export const USER_FACING = {
  backendNeverConnected: "本机服务没连上",
  retryConnection: "重试连接",
  noProject: "还没有工程",
  newProject: "新建工程",
  openProject: "打开工程",
  emptyCanvas: "画布是空的",
  emptyCanvasHintPhase1: "从左侧加上文本节点",
  emptyCanvasHintPhase3: "从左侧加上文本或生成",
  emptyCanvasHintPhase4: "从左侧加上文本或生成，或把图片拖进来",
  addTextNode: "添加文本节点",
  unsaved: "未保存",
  saveFailed: "没能保存，修改还在。",
  textTooLong: "文本太长，没有放进节点。",
  backendDisconnected:
    "本机后端没连上。这个窗口里的修改还在，但现在不能保存，也不能生成。",
  saveConflict: "这份工程在这次打开之后被写过。为避免覆盖，请另存为。",
  schemaVersionNewer: "这份工程是更新的版本写的，画布没有打开它，以免写坏。",
  schemaVersionUnsupported: "还不能打开这个版本的工程。",
  autosaveFailed: "自动保存失败，当前修改还在这个页面上。",
  workingCopySyncFailed: "工作副本没能同步，现在不能跑。",
  viewportSaveFailed: "视图没能记住，下次打开会回到默认位置",
  restoredFromAutosave: "已从自动保存恢复。",
  mediaMissing: "找不到原来的媒体文件",
  openedFromBackup: "工程文件损坏，已打开上一份备份。",
  projectCorruptNoBackup: "工程文件损坏，而且没有可用的备份。文件还留在原地。",
  ticketExpired: "预览地址已过期。",
  emptyText: "还没有文字",
  emptyImage: "还没有图片",
  emptyVideo: "还没有视频",
  emptyAudio: "还没有音频",
  textKindLabel: "文本",
  generationKindLabel: "生成",
  emptyGenerationPreview: "运行后，结果会出现在这里",
  thumbFailed: "缩略图没加载出来",
  thumbRetry: "重试",
  groupNeedTwo: "至少选中两个节点才能成组",
  selectedCount: (n: number): string => `已选 ${n} 个`,
  staleHover: "上游改过了，不会自动重跑。",
  notImplemented: "这一类还没接入。",
  selfLoop: "不能连到自己",
  cycleConnect: "会形成循环，已取消",
  connectToBlank: "要连到槽上，已取消",
  connectFarLod: "放大到能看清槽之后再松开",
  videoCannotConnect:
    "视频结果现在还不能接到别的槽上。要用画面的话，拖首帧或尾帧。",
  textToReferenceImage: "这里要的是参考图，这条线是提示词",
  audioToReferenceImage: "这里要的是参考图，这条线是音频参考",
  kindMismatch: (sourceKindLabel: string, roleLabel: string): string =>
    `不能把「${sourceKindLabel}」接到「${roleLabel}」槽`,
  generationFailedNoDetail: "生成失败，没有更多说明。",
  promptFromEdge: "提示词来自连线",
  slotRequired: "必填",
  slotOptional: "可选",
  slotConnectedNoOutput: "已连接，对方还没有结果",
  runThisNode: "运行此节点",
  runDownstream: "运行下游",
  runSelection: "运行选中部分",
  runFreshConfirm:
    "当前结果还没过期。再跑会新增一个版本，旧结果还留在版本里，不会被盖掉。",
  runSelectionConfirm:
    "选中的生成节点都会再跑，包括还没过期的。每个都会新增版本。",
  runDisabledText: "文本不用跑。改字之后，用到它的节点会标成过期。",
  runDisabledOffline: "后端没连上，现在不能跑。",
  recipeNotFound: "找不到这张配方。",
  recipeUiFormat: "这是 ComfyUI 的界面格式。本应用只接受 API 格式，并且要包在我们自己的配方里。",
  recipeBarePrompt: "请把 API 格式工作流放进配方的 comfy.prompt，不要单独导入一张工作流。",
  handingToLocalQueue: "正在交给本机队列",
  localQueueAhead: formatLocalQueueAhead,
  queuedBehind: formatLocalQueueAhead,
  generatingLabel: "正在生成",
  generatingElapsed: formatGeneratingElapsed,
  missingPrompt: "还缺提示词。",
  missingSourceImage: "还缺原图。",
  missingReferenceImage: "还缺参考图。",
  missingFirstFrame: "还缺首帧。",
  retryFailedInputsChanged: "输入已经变了，不能只补失败的那几张。请重新运行这个节点。",
  retryFailed: "只补失败的",
  upstreamNotRun: "上游没成功，这一步没跑。",
  partialSuccess: formatPartialSuccess,
  selectionPartial: formatSelectionPartial,
  runUsesStaleUpstream: "将用上游当前的过期结果运行 1 个节点。",
  runSkippedFresh: "当前结果还没过期，这次跳过。",
  runDownstreamOriginNotRerun: "这次不会重跑当前节点。",
  variantCountLabel: "变体张数",
  comfyUnconfigured: "还没有填写本机 ComfyUI 地址。",
  comfyUnconfiguredHint: "可以先摆节点。生成要等连接之后。",
  comfyUnreachable: "连不上本机 ComfyUI。请确认它已启动，并且后端配置的地址可达。",
  comfyRejected: "ComfyUI 拒绝了这次提交。",
  comfyFailed: "ComfyUI 执行失败。",
  comfyNoImage: "ComfyUI 说完成了，但没有返回图片。",
  comfyUploadFailed: "图片没有传给 ComfyUI。",
  cancelling: "正在取消",
  cancelledNoResult: "已取消，没有新结果",
  tooLateToCancel: "来不及取消，结果已经完成",
  cancelUncertain: "取消结果不确定",
  generationIncomplete: "生成没有完成",
  inputsChangedAfterRun: "跑完的时候输入已经变了，这张图已标成过期。",
  inputsChangedWhileRunning: "跑完的时候输入已经变了，这张图已标成过期。",
  alreadyRunning: "这个节点已经在跑。",
  ingestFailed: "这张图没能放进媒体库。",
  ingestSvg: "第一版不接收 SVG。",
  svgRejected: "第一版不接收 SVG。",
  ingestTooLarge: "单个文件超过 2 GiB，第一版不接收。",
  fileTooLarge: "单个文件超过 2 GiB，第一版不接收。",
  thumbPartial: "缩略图没加载出来",
  slotUnsupportedMask: "这张配方还不能用遮罩。",
  slotUnsupportedReference: "这张配方还不能用参考图。",
  durationNotAllowed: "时长（秒）只能是 2、4 或 8。",
  secretMissing: "还没有配置这一家的密钥。",
  secretConfigured: "已配置",
  secretNotConfigured: "未配置",
  secretRefillOnThisComputer: "没有找到这个提供方的密钥。请在这台电脑上重新填写。",
  secretRejected: "密钥被拒绝。",
  secretStoreRejected: "系统凭据库拒绝保存这把密钥。密钥没有写入工程。",
  previewPending: "正在准备预览",
  videoFileWithoutPreview: "视频文件已经下载，但封面或代理没有生成，画布还不能播放。",
  regeneratePreview: "重新生成预览",
  lastFrameApproximate: "尾帧是近似的，本机还没有核实。",
  durationUnknown: "时长未知",
  slotWantsImage: "这个槽要的是图片，连进来的不是。",
  cycleCannotPlan: "这些节点连成了环，没法决定先跑谁。",
  restartUncertain: "本机服务重启过，这个任务的结果不确定。",
  resumeHint: "可以重新运行或续跑。",
  cloudHeartbeat: formatCloudHeartbeat,
  moreRunning: formatMoreRunning,
  stoppedWaiting: "已停止在这里等待",
  cloudCancelMayFinish: "对方可能仍会完成，本应用不再接收那次结果。",
  queueEmpty: "现在没有在跑的任务",
  submittedWaitingInterrupt: "已提交，等它一开始就停止。",
  paramOutOfRange: formatParamOutOfRange,
  badgeEmpty: "空",
  badgeQueued: "排队",
  badgeRunning: "运行",
  badgeSucceeded: "成功",
  badgeFailed: "失败",
  badgeStale: "过期",
} as const;

/** 端口占用句。把实际尝试的端口填进去，不得把 8787 写死。 */
export function portOccupiedMessage(port: number): string {
  return `端口 ${port} 已被占用。如果画布后端已经在运行，请打开原来的地址；否则换一个端口再启动。`;
}
