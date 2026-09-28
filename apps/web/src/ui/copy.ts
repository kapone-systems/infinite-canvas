import { portOccupiedMessage as formatPortOccupied, USER_FACING } from "@canvas/schema";

/**
 * 方案第 11.1 节与阶段 1 主句。取值来自 @canvas/schema，字面量用 satisfies 钉死，避免前端另写一套。
 */
export const COPY = {
  backendNeverConnected: USER_FACING.backendNeverConnected satisfies "本机服务没连上",
  retryConnection: USER_FACING.retryConnection satisfies "重试连接",
  noProject: USER_FACING.noProject satisfies "还没有工程",
  newProject: USER_FACING.newProject satisfies "新建工程",
  openProject: USER_FACING.openProject satisfies "打开工程",
  emptyCanvas: USER_FACING.emptyCanvas satisfies "画布是空的",
  emptyCanvasHint: USER_FACING.emptyCanvasHintPhase4 satisfies "从左侧加上文本或生成，或把图片拖进来",
  addTextNode: USER_FACING.addTextNode satisfies "添加文本节点",
  unsaved: USER_FACING.unsaved satisfies "未保存",
  saveFailed: USER_FACING.saveFailed satisfies "没能保存，修改还在。",
  textTooLong: USER_FACING.textTooLong satisfies "文本太长，没有放进节点。",
  backendDisconnected: USER_FACING.backendDisconnected satisfies
    "本机后端没连上。这个窗口里的修改还在，但现在不能保存，也不能生成。",
  saveConflict: USER_FACING.saveConflict satisfies
    "这份工程在这次打开之后被写过。为避免覆盖，请另存为。",
  schemaVersionNewer: USER_FACING.schemaVersionNewer satisfies
    "这份工程是更新的版本写的，画布没有打开它，以免写坏。",
  schemaVersionUnsupported: USER_FACING.schemaVersionUnsupported satisfies
    "还不能打开这个版本的工程。",
  autosaveFailed: USER_FACING.autosaveFailed satisfies
    "自动保存失败，当前修改还在这个页面上。",
  workingCopySyncFailed: USER_FACING.workingCopySyncFailed satisfies
    "工作副本没能同步，现在不能跑。",
  viewportSaveFailed: USER_FACING.viewportSaveFailed satisfies
    "视图没能记住，下次打开会回到默认位置",
  restoredFromAutosave: USER_FACING.restoredFromAutosave satisfies "已从自动保存恢复。",
  mediaMissing: USER_FACING.mediaMissing satisfies "找不到原来的媒体文件",
  openedFromBackup: USER_FACING.openedFromBackup satisfies "工程文件损坏，已打开上一份备份。",
  projectCorruptNoBackup: USER_FACING.projectCorruptNoBackup satisfies
    "工程文件损坏，而且没有可用的备份。文件还留在原地。",
  emptyTrash: "清空回收站",
  viewLargeImage: "查看大图",
  closeViewer: "关闭",
  emptyText: USER_FACING.emptyText satisfies "还没有文字",
  emptyImage: USER_FACING.emptyImage satisfies "还没有图片",
  emptyVideo: USER_FACING.emptyVideo satisfies "还没有视频",
  emptyAudio: USER_FACING.emptyAudio satisfies "还没有音频",
  textKindLabel: USER_FACING.textKindLabel satisfies "文本",
  generationKindLabel: USER_FACING.generationKindLabel satisfies "生成",
  emptyGenerationPreview: USER_FACING.emptyGenerationPreview satisfies "运行后，结果会出现在这里",
  thumbFailed: USER_FACING.thumbFailed satisfies "缩略图没加载出来",
  thumbRetry: USER_FACING.thumbRetry satisfies "重试",
  groupNeedTwo: USER_FACING.groupNeedTwo satisfies "至少选中两个节点才能成组",
  selectedCount: USER_FACING.selectedCount,
  save: "保存",
  saveAs: "另存为",
  cancel: "取消",
  connecting: "正在连接本机服务",
  parentDir: "父目录路径",
  projectName: "工程名称",
  projectFolder: "工程文件夹路径",
  saveDisabledClean: "没有需要保存的修改。",
  saveDisabledOffline: "本机后端没连上，所以现在不能保存。",
  saveAsDisabledOffline: "本机后端没连上，所以现在不能另存为。",
  workingCopyBlocksRun: USER_FACING.workingCopySyncFailed,
  staleHover: USER_FACING.staleHover satisfies "上游改过了，不会自动重跑。",
  notImplemented: USER_FACING.notImplemented satisfies "这一类还没接入。",
  runDisabledText: USER_FACING.runDisabledText satisfies
    "文本不用跑。改字之后，用到它的节点会标成过期。",
  runDisabledOffline: USER_FACING.runDisabledOffline satisfies "后端没连上，现在不能跑。",
  runFreshConfirm: USER_FACING.runFreshConfirm satisfies
    "当前结果还没过期。再跑会新增一个版本，旧结果还留在版本里，不会被盖掉。",
  runSelectionConfirm: USER_FACING.runSelectionConfirm satisfies
    "选中的生成节点都会再跑，包括还没过期的。每个都会新增版本。",
  generationFailedNoDetail: USER_FACING.generationFailedNoDetail satisfies "生成失败，没有更多说明。",
  runThisNode: USER_FACING.runThisNode satisfies "运行此节点",
  runDownstream: USER_FACING.runDownstream satisfies "运行下游",
  runSelection: USER_FACING.runSelection satisfies "运行选中部分",
  handingToLocalQueue: USER_FACING.handingToLocalQueue satisfies "正在交给本机队列",
  localQueueAhead: USER_FACING.localQueueAhead,
  generatingElapsed: USER_FACING.generatingElapsed,
  missingPrompt: USER_FACING.missingPrompt satisfies "还缺提示词。",
  missingSourceImage: USER_FACING.missingSourceImage satisfies "还缺原图。",
  missingReferenceImage: USER_FACING.missingReferenceImage satisfies "还缺参考图。",
  slotUnsupportedMask: USER_FACING.slotUnsupportedMask satisfies "这张配方还不能用遮罩。",
  retryFailedInputsChanged: USER_FACING.retryFailedInputsChanged satisfies
    "输入已经变了，不能只补失败的那几张。请重新运行这个节点。",
  retryFailed: USER_FACING.retryFailed satisfies "只补失败的",
  upstreamNotRun: USER_FACING.upstreamNotRun satisfies "上游没成功，这一步没跑。",
  partialSuccess: USER_FACING.partialSuccess,
  selectionPartial: USER_FACING.selectionPartial,
  runUsesStaleUpstream: USER_FACING.runUsesStaleUpstream satisfies
    "将用上游当前的过期结果运行 1 个节点。",
  runSkippedFresh: USER_FACING.runSkippedFresh satisfies "当前结果还没过期，这次跳过。",
  runDownstreamOriginNotRerun: USER_FACING.runDownstreamOriginNotRerun satisfies
    "这次不会重跑当前节点。",
  variantCountLabel: USER_FACING.variantCountLabel satisfies "变体张数",
  comfyUnconfigured: USER_FACING.comfyUnconfigured satisfies "还没有填写本机 ComfyUI 地址。",
  comfyUnconfiguredHint: USER_FACING.comfyUnconfiguredHint satisfies "可以先摆节点。生成要等连接之后。",
  comfyUnreachable: USER_FACING.comfyUnreachable satisfies
    "连不上本机 ComfyUI。请确认它已启动，并且后端配置的地址可达。",
  cancelling: USER_FACING.cancelling satisfies "正在取消",
  cancelledNoResult: USER_FACING.cancelledNoResult satisfies "已取消，没有新结果",
  tooLateToCancel: USER_FACING.tooLateToCancel satisfies "来不及取消，结果已经完成",
  cancelUncertain: USER_FACING.cancelUncertain satisfies "取消结果不确定",
  stoppedWaiting: USER_FACING.stoppedWaiting satisfies "已停止在这里等待",
  cloudCancelMayFinish: USER_FACING.cloudCancelMayFinish satisfies
    "对方可能仍会完成，本应用不再接收那次结果。",
  cloudHeartbeat: USER_FACING.cloudHeartbeat,
  moreRunning: USER_FACING.moreRunning,
  queueEmpty: USER_FACING.queueEmpty satisfies "现在没有在跑的任务",
  restartUncertain: USER_FACING.restartUncertain satisfies "本机服务重启过，这个任务的结果不确定。",
  resumeHint: USER_FACING.resumeHint satisfies "可以重新运行或续跑。",
  generationIncomplete: USER_FACING.generationIncomplete satisfies "生成没有完成",
  inputsChangedAfterRun: USER_FACING.inputsChangedAfterRun satisfies
    "跑完的时候输入已经变了，这张图已标成过期。",
  alreadyRunning: USER_FACING.alreadyRunning satisfies "这个节点已经在跑。",
  ingestFailed: USER_FACING.ingestFailed satisfies "这张图没能放进媒体库。",
  ingestSvg: USER_FACING.ingestSvg satisfies "第一版不接收 SVG。",
  ingestTooLarge: USER_FACING.ingestTooLarge satisfies "单个文件超过 2 GiB，第一版不接收。",
  recipeNotFound: USER_FACING.recipeNotFound satisfies "找不到这张配方。",
  settings: "设置",
  comfyAddressLabel: "本机 ComfyUI 地址",
  recheckComfy: "重新检查 ComfyUI",
  remoteComputer: "远程电脑",
  sshHost: "主机",
  sshPort: "SSH 端口",
  sshUsername: "用户名",
  remoteComfyPort: "远端 ComfyUI 端口",
  sshSecret: "密码或私钥",
  connectRemoteComfy: "连接远程 ComfyUI",
  disconnectRemote: "断开",
  useLocalComfy: "使用本机 ComfyUI",
  useLocalComfyHint: "打开后，运行改走这个地址上的 ComfyUI，不再用替身。报文还没有核实。",
  opensshClientRequired: USER_FACING.opensshClientRequired satisfies "需要系统可选功能「OpenSSH 客户端」。",
  promptFromEdge: USER_FACING.promptFromEdge satisfies "提示词来自连线",
  slotRequired: USER_FACING.slotRequired satisfies "必填",
  slotOptional: USER_FACING.slotOptional satisfies "可选",
  slotConnectedNoOutput: USER_FACING.slotConnectedNoOutput satisfies "已连接，对方还没有结果",
  badgeEmpty: USER_FACING.badgeEmpty satisfies "空",
  badgeQueued: USER_FACING.badgeQueued satisfies "排队",
  badgeRunning: USER_FACING.badgeRunning satisfies "运行",
  badgeSucceeded: USER_FACING.badgeSucceeded satisfies "成功",
  badgeFailed: USER_FACING.badgeFailed satisfies "失败",
  badgeStale: USER_FACING.badgeStale satisfies "过期",
  runConfirmAction: "新增版本并运行",
  addSlot: "添加槽",
  laterTitle: "以后再做",
  durationUnknown: USER_FACING.durationUnknown satisfies "时长未知",
  previewPending: USER_FACING.previewPending satisfies "正在准备预览",
  videoFileWithoutPreview: USER_FACING.videoFileWithoutPreview satisfies
    "视频文件已经下载，但封面或代理没有生成，画布还不能播放。",
  regeneratePreview: USER_FACING.regeneratePreview satisfies "重新生成预览",
  lastFrameApproximate: USER_FACING.lastFrameApproximate satisfies "尾帧是近似的，本机还没有核实。",
  secretMissing: USER_FACING.secretMissing satisfies "还没有配置这一家的密钥。",
  secretConfigured: USER_FACING.secretConfigured satisfies "已配置",
  secretNotConfigured: USER_FACING.secretNotConfigured satisfies "未配置",
  secretRefillOnThisComputer: USER_FACING.secretRefillOnThisComputer satisfies
    "没有找到这个提供方的密钥。请在这台电脑上重新填写。",
  secretRejected: USER_FACING.secretRejected satisfies "密钥被拒绝。",
  secretStoreRejected: USER_FACING.secretStoreRejected satisfies
    "系统凭据库拒绝保存这把密钥。密钥没有写入工程。",
  durationNotAllowed: USER_FACING.durationNotAllowed satisfies "时长（秒）只能是 2、4 或 8。",
  playProxy: "播放",
  pauseAudio: "暂停",
  seedRandom: "随机",
  createPathHint: "粘贴父目录的绝对路径，并填写工程名称。第一周只用粘贴，没有文件夹窗口。",
  openPathHint: "粘贴工程文件夹的绝对路径。",
  saveAsHint: "另存为会换新的工程文件夹和新的工程 id。",
  submitCreate: "创建",
  submitOpen: "打开",
  submitSaveAs: "另存为到这里",
} as const;

/** 方案第 6 节。实际端口由函数填入，不得写死 8787。 */
export const PORT_OCCUPIED_TEMPLATE =
  "端口 <实际端口> 已被占用。如果画布后端已经在运行，请打开原来的地址；否则换一个端口再启动。";

export function portOccupiedMessage(port: number): string {
  void PORT_OCCUPIED_TEMPLATE;
  return formatPortOccupied(port);
}

/** 工具栏「以后再做」点击：只留主句，不建节点、不入队。 */
export function unimplementedCapabilityClick(): {
  message: typeof COPY.notImplemented;
  added: false;
} {
  return { message: COPY.notImplemented, added: false };
}
