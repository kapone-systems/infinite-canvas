import { portOccupiedMessage, USER_FACING } from "@canvas/schema";

export { portOccupiedMessage, USER_FACING };

/** 后端补充人话。第 11.1 节已有的句子一律从 USER_FACING 取。 */
export const BACKEND_MESSAGES = {
  lockHeld: "画布后端已经在运行。",
  missingLocalAppData: "找不到 LOCALAPPDATA，无法确定应用数据目录。",
  invalidListenPort: "端口无效。",
  invalidProjectName: "工程名不能使用。",
  forbiddenProjectLocation: "不能把工程放在这个位置。",
  projectFolderExists: "这个名字的文件夹已经在了。",
  parentDirMissing: "找不到这个工程文件夹。",
  projectPathMissing: "找不到这个工程文件夹。",
  unsavedProjectOpen: "已有未保存的工程。请先保存或另存为。",
  unauthorized: "需要令牌。",
  forbiddenRequest: "拒绝这个请求。",
  invalidMediaPath: "路径不合法。",
  payloadTooLarge: "请求太大。",
  diskFull: "磁盘已满，结果没有写入媒体库。腾出空间后可以重试保存，生成不会自动重跑。",
  hashMismatch: "媒体库里已有的文件和摘要对不上，新结果没有覆盖它。",
  invalidJson: "请求体不是合法 JSON。",
  requestFailed: "请求没能完成。",
  webRootMissing: "找不到可演示的界面文件。请先构建前端，或用 --serve-web 指定含 index.html 的目录。",
} as const;
