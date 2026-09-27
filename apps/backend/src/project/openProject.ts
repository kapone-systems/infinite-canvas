import { readFile, stat } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import type { CanvasProjectFile } from "@canvas/schema";
import { isIssue, validateProject } from "@canvas/schema";
import { listMissingBlobPaths, recycleUnreferencedMedia } from "../media/recycle.ts";
import { BACKEND_MESSAGES, USER_FACING } from "../messages.ts";
import { isErrno, projectBakPath, projectFilePath } from "./atomicWrite.ts";
import { isAutosaveNewer, readAutosaveFile } from "./autosave.ts";
import {
  isForbiddenProjectFolder,
  pathsEqual,
  type ForbiddenLocationContext,
} from "./forbiddenLocations.ts";
import { readCanvasFile } from "./readCanvasFile.ts";
import type { OpenedProject, ProjectSession } from "./workingCopy.ts";

export type OpenProjectResult =
  | {
      ok: true;
      opened: OpenedProject;
      dirty: boolean;
      message: string | null;
      missingMedia: string[];
    }
  | { ok: false; status: number; message: string };

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

export async function readOfficialProject(projectDir: string): Promise<
  | { ok: true; project: CanvasProjectFile; mtimeMs: number }
  | { ok: false; status: number; message: string }
> {
  const filePath = projectFilePath(projectDir);
  try {
    const [text, info] = await Promise.all([readFile(filePath, "utf8"), stat(filePath)]);
    let parsed: unknown;
    try {
      parsed = JSON.parse(stripBom(text));
    } catch {
      return { ok: false, status: 400, message: USER_FACING.schemaVersionUnsupported };
    }
    const validated = validateProject(parsed);
    if (isIssue(validated)) {
      return { ok: false, status: validated.httpStatus, message: validated.message };
    }
    return { ok: true, project: validated.project, mtimeMs: info.mtimeMs };
  } catch (err) {
    if (isErrno(err, "ENOENT")) {
      return { ok: false, status: 404, message: BACKEND_MESSAGES.projectPathMissing };
    }
    return { ok: false, status: 400, message: USER_FACING.schemaVersionUnsupported };
  }
}

export async function openProjectFromPath(
  absolutePath: unknown,
  session: ProjectSession,
  ctx: ForbiddenLocationContext,
): Promise<OpenProjectResult> {
  if (typeof absolutePath !== "string" || absolutePath.length === 0 || !isAbsolute(absolutePath)) {
    return { ok: false, status: 404, message: BACKEND_MESSAGES.projectPathMissing };
  }
  const projectDir = resolve(absolutePath);

  if (session.current !== null && pathsEqual(session.current.absolutePath, projectDir)) {
    return {
      ok: true,
      opened: session.current,
      dirty: session.isDirty(),
      message: session.current.restoredFromAutosave ? USER_FACING.restoredFromAutosave : null,
      missingMedia: await safeMissing(projectDir, session.current.project),
    };
  }

  if (session.isDirty()) {
    return { ok: false, status: 409, message: BACKEND_MESSAGES.unsavedProjectOpen };
  }

  try {
    const info = await stat(projectDir);
    if (!info.isDirectory()) {
      return { ok: false, status: 404, message: BACKEND_MESSAGES.projectPathMissing };
    }
  } catch {
    return { ok: false, status: 404, message: BACKEND_MESSAGES.projectPathMissing };
  }

  if (isForbiddenProjectFolder(projectDir, ctx)) {
    return { ok: false, status: 400, message: BACKEND_MESSAGES.forbiddenProjectLocation };
  }

  const official = await readCanvasFile(projectFilePath(projectDir));
  if (official.state === "missing") {
    return { ok: false, status: 404, message: BACKEND_MESSAGES.projectPathMissing };
  }
  if (official.state === "invalid") {
    return { ok: false, status: official.httpStatus, message: official.message };
  }
  if (official.state === "parse-error") {
    return openDamagedOfficial(projectDir, session);
  }

  let project = official.project;
  let restoredFromAutosave = false;
  const autosave = await readAutosaveFile(projectDir);
  if (
    autosave !== null &&
    isAutosaveNewer({
      official: official.project,
      officialMtimeMs: official.mtimeMs,
      autosave: autosave.project,
      autosaveMtimeMs: autosave.mtimeMs,
    })
  ) {
    project = {
      ...autosave.project,
      savedContentRevision: official.project.savedContentRevision,
    };
    restoredFromAutosave = true;
  }

  const opened: OpenedProject = {
    absolutePath: projectDir,
    project,
    openedDiskContentRevision: official.project.contentRevision,
    restoredFromAutosave,
  };
  session.setCurrent(opened);
  await safeRecycle(projectDir);
  return {
    ok: true,
    opened,
    dirty: session.isDirty(),
    message: restoredFromAutosave ? USER_FACING.restoredFromAutosave : null,
    missingMedia: await safeMissing(projectDir, project),
  };
}

async function openDamagedOfficial(
  projectDir: string,
  session: ProjectSession,
): Promise<OpenProjectResult> {
  const bak = await readCanvasFile(projectBakPath(projectDir));
  if (bak.state === "missing" || bak.state === "parse-error") {
    return { ok: false, status: 422, message: USER_FACING.projectCorruptNoBackup };
  }
  if (bak.state === "invalid") {
    return { ok: false, status: bak.httpStatus, message: bak.message };
  }
  const opened: OpenedProject = {
    absolutePath: projectDir,
    project: bak.project,
    openedDiskContentRevision: bak.project.contentRevision,
    restoredFromAutosave: false,
    openMessage: USER_FACING.openedFromBackup,
  };
  session.setCurrent(opened);
  await safeRecycle(projectDir);
  return {
    ok: true,
    opened,
    dirty: session.isDirty(),
    message: USER_FACING.openedFromBackup,
    missingMedia: await safeMissing(projectDir, bak.project),
  };
}

async function safeRecycle(projectDir: string): Promise<void> {
  try {
    await recycleUnreferencedMedia(projectDir);
  } catch {
    /* 回收失败不挡住打开，也不在这里删文件 */
  }
}

async function safeMissing(projectDir: string, project: CanvasProjectFile): Promise<string[]> {
  try {
    return await listMissingBlobPaths(projectDir, project);
  } catch {
    return [];
  }
}
