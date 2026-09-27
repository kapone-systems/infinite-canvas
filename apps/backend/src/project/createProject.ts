import { mkdir, stat } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { createEmptyProject, findForbiddenKey, isIssue, validateProject } from "@canvas/schema";
import type { CanvasProjectFile } from "@canvas/schema";
import { BACKEND_MESSAGES } from "../messages.ts";
import { atomicWriteJson, isErrno, projectFilePath, serializeProjectFile } from "./atomicWrite.ts";
import {
  isForbiddenProjectFolder,
  projectDirFromParent,
  type ForbiddenLocationContext,
} from "./forbiddenLocations.ts";
import { isValidWindowsFolderName } from "./windowsName.ts";
import { type OpenedProject, type ProjectSession } from "./workingCopy.ts";

export type CreateProjectInput = {
  parentDir: string;
  name: string;
};

export type ProjectActionFailure = {
  ok: false;
  status: number;
  message: string;
};

export type CreateProjectSuccess = {
  ok: true;
  opened: OpenedProject;
};

function fail(status: number, message: string): ProjectActionFailure {
  return { ok: false, status, message };
}

export function asRecord(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

export async function createNewProject(
  input: CreateProjectInput,
  session: ProjectSession,
  ctx: ForbiddenLocationContext,
): Promise<CreateProjectSuccess | ProjectActionFailure> {
  if (session.isDirty()) {
    return fail(409, BACKEND_MESSAGES.unsavedProjectOpen);
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
  const project = createEmptyProject({
    projectId: randomUUID(),
    name: input.name,
    now,
  });
  if (findForbiddenKey(project) !== null) {
    return fail(400, BACKEND_MESSAGES.invalidProjectName);
  }
  const validated = validateProject(serializeProjectFile(project));
  if (isIssue(validated)) {
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
    await atomicWriteJson(projectFilePath(projectDir), serializeProjectFile(validated.project), {
      backup: true,
    });
  } catch {
    return fail(500, BACKEND_MESSAGES.requestFailed);
  }

  const opened: OpenedProject = {
    absolutePath: projectDir,
    project: validated.project,
    openedDiskContentRevision: validated.project.contentRevision,
    restoredFromAutosave: false,
  };
  session.setCurrent(opened);
  return { ok: true, opened };
}

export function createResponseBody(opened: OpenedProject): {
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
