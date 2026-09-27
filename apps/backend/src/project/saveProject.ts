import { randomUUID } from "node:crypto";
import { mkdir, stat } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import type { Camera, CanvasProjectFile } from "@canvas/schema";
import { findForbiddenKey, isIssue, validateProject } from "@canvas/schema";
import { BACKEND_MESSAGES, USER_FACING } from "../messages.ts";
import {
  atomicWriteJson,
  isErrno,
  projectFilePath,
  serializeProjectFile,
} from "./atomicWrite.ts";
import { removeAutosave } from "./autosave.ts";
import {
  isForbiddenProjectFolder,
  projectDirFromParent,
  type ForbiddenLocationContext,
} from "./forbiddenLocations.ts";
import { readOfficialProject } from "./openProject.ts";
import { isValidWindowsFolderName } from "./windowsName.ts";
import { type OpenedProject, type ProjectSession } from "./workingCopy.ts";

export type SaveResult =
  | { ok: true; project: CanvasProjectFile }
  | { ok: false; status: number; message: string };

function fail(status: number, message: string): SaveResult {
  return { ok: false, status, message };
}

export function statusForWriteError(err: unknown, failureMessage: string): SaveResult {
  if (isErrno(err, "ENOSPC") || isErrno(err, "EDQUOT")) {
    return fail(507, failureMessage);
  }
  return fail(500, failureMessage);
}

function prepareForSave(project: CanvasProjectFile, now: Date): SaveResult {
  if (findForbiddenKey(project) !== null) {
    return fail(400, USER_FACING.saveFailed);
  }
  const next: CanvasProjectFile = serializeProjectFile({
    ...project,
    savedContentRevision: project.contentRevision,
    updatedAt: now.toISOString(),
  });
  const validated = validateProject(next);
  if (isIssue(validated)) {
    if (validated.code === "forbidden_key" || validated.code === "data_uri") {
      return fail(400, USER_FACING.saveFailed);
    }
    return fail(validated.httpStatus, validated.message);
  }
  return { ok: true, project: validated.project };
}

export async function saveOpenedProject(
  session: ProjectSession,
  requestBody: unknown,
): Promise<SaveResult> {
  if (session.current === null) {
    return fail(404, USER_FACING.noProject);
  }
  if (requestBody !== undefined && requestBody !== null) {
    if (typeof requestBody !== "object" || Array.isArray(requestBody)) {
      return fail(400, USER_FACING.saveFailed);
    }
    if (findForbiddenKey(requestBody) !== null) {
      return fail(400, USER_FACING.saveFailed);
    }
  }

  session.cancelAutosaveTimer();
  const opened = session.current;
  const disk = await readOfficialProject(opened.absolutePath);
  if (!disk.ok) {
    if (session.isDirty()) {
      session.scheduleAutosave();
    }
    return fail(disk.status === 404 ? 500 : disk.status, USER_FACING.saveFailed);
  }
  if (disk.project.contentRevision !== opened.openedDiskContentRevision) {
    if (session.isDirty()) {
      session.scheduleAutosave();
    }
    return fail(409, USER_FACING.saveConflict);
  }

  const prepared = prepareForSave(opened.project, session.timestamp());
  if (!prepared.ok) {
    if (session.isDirty()) {
      session.scheduleAutosave();
    }
    return prepared;
  }
  const toWrite = prepared.project;

  try {
    await atomicWriteJson(projectFilePath(opened.absolutePath), toWrite, { backup: true });
  } catch (err) {
    if (session.isDirty()) {
      session.scheduleAutosave();
    }
    return statusForWriteError(err, USER_FACING.saveFailed);
  }

  opened.project = toWrite;
  opened.openedDiskContentRevision = toWrite.contentRevision;
  opened.restoredFromAutosave = false;
  try {
    await removeAutosave(opened.absolutePath);
  } catch {
    /* 正式文件已写完；清 autosave 失败不把保存打成失败 */
  }
  return { ok: true, project: toWrite };
}

export async function saveOpenedProjectAs(
  session: ProjectSession,
  input: { parentDir: string; name: string },
  ctx: ForbiddenLocationContext,
): Promise<SaveResult & { opened?: OpenedProject }> {
  if (session.current === null) {
    return fail(404, USER_FACING.noProject);
  }
  if (typeof input.parentDir !== "string" || !isAbsolute(input.parentDir)) {
    return fail(400, BACKEND_MESSAGES.parentDirMissing);
  }
  if (!isValidWindowsFolderName(input.name)) {
    return fail(400, BACKEND_MESSAGES.invalidProjectName);
  }
  const parentDir = resolve(input.parentDir);
  try {
    const parentInfo = await stat(parentDir);
    if (!parentInfo.isDirectory()) {
      return fail(400, BACKEND_MESSAGES.parentDirMissing);
    }
  } catch (err) {
    if (isErrno(err, "ENOENT")) {
      return fail(404, BACKEND_MESSAGES.parentDirMissing);
    }
    return fail(400, BACKEND_MESSAGES.parentDirMissing);
  }

  const projectDir = projectDirFromParent(parentDir, input.name);
  if (isForbiddenProjectFolder(projectDir, ctx)) {
    return fail(400, BACKEND_MESSAGES.forbiddenProjectLocation);
  }

  const now = session.timestamp();
  const source = session.current.project;
  const next: CanvasProjectFile = serializeProjectFile({
    ...source,
    projectId: randomUUID(),
    name: input.name,
    savedContentRevision: source.contentRevision,
    updatedAt: now.toISOString(),
  });
  if (findForbiddenKey(next) !== null || findForbiddenKey(source) !== null) {
    return fail(400, USER_FACING.saveFailed);
  }
  const validated = validateProject(next);
  if (isIssue(validated)) {
    if (validated.code === "forbidden_key" || validated.code === "data_uri") {
      return fail(400, USER_FACING.saveFailed);
    }
    return fail(validated.httpStatus, validated.message);
  }

  try {
    await mkdir(projectDir);
  } catch (err) {
    if (isErrno(err, "EEXIST")) {
      return fail(409, BACKEND_MESSAGES.projectFolderExists);
    }
    return fail(400, BACKEND_MESSAGES.forbiddenProjectLocation);
  }

  try {
    await atomicWriteJson(projectFilePath(projectDir), validated.project, { backup: true });
  } catch (err) {
    return statusForWriteError(err, USER_FACING.saveFailed);
  }

  session.cancelAutosaveTimer();
  const opened: OpenedProject = {
    absolutePath: projectDir,
    project: validated.project,
    openedDiskContentRevision: validated.project.contentRevision,
    restoredFromAutosave: false,
  };
  session.setCurrent(opened);
  return { ok: true, project: validated.project, opened };
}

export async function persistViewport(
  session: ProjectSession,
  camera: Camera,
): Promise<SaveResult> {
  if (session.current === null) {
    return fail(404, USER_FACING.noProject);
  }
  const opened = session.current;
  const disk = await readOfficialProject(opened.absolutePath);
  if (!disk.ok) {
    return fail(disk.status === 404 ? 500 : disk.status, USER_FACING.viewportSaveFailed);
  }
  const nextDisk = serializeProjectFile({
    ...disk.project,
    viewport: camera,
  });
  const validated = validateProject(nextDisk);
  if (isIssue(validated)) {
    return fail(400, USER_FACING.viewportSaveFailed);
  }
  try {
    await atomicWriteJson(projectFilePath(opened.absolutePath), validated.project, { backup: true });
  } catch {
    return fail(500, USER_FACING.viewportSaveFailed);
  }
  session.setViewport(camera);
  return { ok: true, project: opened.project };
}

export function saveAsResponse(opened: OpenedProject): {
  projectId: string;
  name: string;
  absolutePath: string;
  project: CanvasProjectFile;
} {
  return {
    projectId: opened.project.projectId,
    name: opened.project.name,
    absolutePath: opened.absolutePath,
    project: opened.project,
  };
}
