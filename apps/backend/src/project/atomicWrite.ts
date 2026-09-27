import { copyFile, rename, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { existsSync } from "node:fs";
import type { CanvasProjectFile } from "@canvas/schema";

export const PROJECT_FILE_NAME = "canvas.project.json";
export const PROJECT_BAK_NAME = "canvas.project.json.bak";
export const PROJECT_AUTOSAVE_NAME = "canvas.project.autosave.json";

export function projectFilePath(projectDir: string): string {
  return join(projectDir, PROJECT_FILE_NAME);
}

export function projectBakPath(projectDir: string): string {
  return join(projectDir, PROJECT_BAK_NAME);
}

export function projectAutosavePath(projectDir: string): string {
  return join(projectDir, PROJECT_AUTOSAVE_NAME);
}

export function isErrno(err: unknown, code: string): boolean {
  return typeof err === "object" && err !== null && "code" in err && (err as { code: unknown }).code === code;
}

export type AtomicWriteOptions = {
  backup?: boolean;
};

async function replaceFile(tmpPath: string, targetPath: string): Promise<void> {
  if (existsSync(targetPath)) {
    // 覆盖已有文件。目标只读时 copyFile 失败，原文不动。
    await copyFile(tmpPath, targetPath);
    await unlink(tmpPath);
    return;
  }
  await rename(tmpPath, targetPath);
}

/**
 * 先写同目录临时文件再替换。backup 为真且目标已存在时，先复制成 target.bak。
 */
export async function atomicWriteFile(
  targetPath: string,
  contents: string,
  options: AtomicWriteOptions = {},
): Promise<void> {
  const backup = options.backup === true;
  const dir = dirname(targetPath);
  const tmpPath = join(dir, `.${basename(targetPath)}.${process.pid}.${Date.now()}.tmp`);
  await writeFile(tmpPath, contents, { encoding: "utf8", flag: "w" });
  try {
    if (backup && existsSync(targetPath)) {
      await copyFile(targetPath, `${targetPath}.bak`);
    }
    await replaceFile(tmpPath, targetPath);
  } catch (err) {
    try {
      await unlink(tmpPath);
    } catch {
      /* ignore */
    }
    throw err;
  }
}

export async function atomicWriteJson(
  targetPath: string,
  value: unknown,
  options: AtomicWriteOptions = {},
): Promise<void> {
  const text = `${JSON.stringify(value, null, 2)}\n`;
  await atomicWriteFile(targetPath, text, options);
}

/** 只写出契约字段，避免 extra 键（含 absolutePath）进工程文件。 */
export function serializeProjectFile(project: CanvasProjectFile): CanvasProjectFile {
  return {
    format: project.format,
    schemaVersion: project.schemaVersion,
    projectId: project.projectId,
    name: project.name,
    mediaHashAlgorithm: project.mediaHashAlgorithm,
    contentRevision: project.contentRevision,
    savedContentRevision: project.savedContentRevision,
    nextSerial: project.nextSerial,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    viewport: project.viewport,
    nodes: project.nodes,
    edges: project.edges,
    groups: project.groups,
  };
}
