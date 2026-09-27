import { readFile, stat, unlink } from "node:fs/promises";
import type { CanvasProjectFile } from "@canvas/schema";
import { findForbiddenKey, isIssue, validateProject } from "@canvas/schema";
import { USER_FACING } from "../messages.ts";
import { atomicWriteJson, projectAutosavePath, serializeProjectFile } from "./atomicWrite.ts";

export type AutosaveResult =
  | { ok: true }
  | { ok: false; message: string };

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

export async function writeAutosave(
  projectDir: string,
  project: CanvasProjectFile,
): Promise<AutosaveResult> {
  const target = projectAutosavePath(projectDir);
  const snapshot = serializeProjectFile(project);
  if (findForbiddenKey(project) !== null) {
    return { ok: false, message: USER_FACING.autosaveFailed };
  }
  const validated = validateProject(snapshot);
  if (isIssue(validated)) {
    return { ok: false, message: USER_FACING.autosaveFailed };
  }
  try {
    await atomicWriteJson(target, snapshot, { backup: false });
    return { ok: true };
  } catch {
    return { ok: false, message: USER_FACING.autosaveFailed };
  }
}

export async function removeAutosave(projectDir: string): Promise<void> {
  try {
    await unlink(projectAutosavePath(projectDir));
  } catch (err) {
    if (typeof err === "object" && err !== null && "code" in err && (err as { code: unknown }).code === "ENOENT") {
      return;
    }
    throw err;
  }
}

export async function readAutosaveFile(
  projectDir: string,
): Promise<{ project: CanvasProjectFile; mtimeMs: number } | null> {
  const filePath = projectAutosavePath(projectDir);
  try {
    const [text, info] = await Promise.all([readFile(filePath, "utf8"), stat(filePath)]);
    const parsed: unknown = JSON.parse(stripBom(text));
    const validated = validateProject(parsed);
    if (isIssue(validated)) {
      return null;
    }
    return { project: validated.project, mtimeMs: info.mtimeMs };
  } catch {
    return null;
  }
}

export function isAutosaveNewer(input: {
  official: CanvasProjectFile;
  officialMtimeMs: number;
  autosave: CanvasProjectFile;
  autosaveMtimeMs: number;
}): boolean {
  if (input.autosave.contentRevision > input.official.contentRevision) {
    return true;
  }
  if (input.autosave.contentRevision < input.official.contentRevision) {
    return false;
  }
  return input.autosaveMtimeMs > input.officialMtimeMs;
}
