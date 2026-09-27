import { readFile, stat } from "node:fs/promises";
import type { CanvasProjectFile } from "@canvas/schema";
import { isIssue, validateProject } from "@canvas/schema";
import { USER_FACING } from "../messages.ts";
import { isErrno } from "./atomicWrite.ts";

export type ReadCanvasFileResult =
  | { state: "missing" }
  | { state: "parse-error" }
  | { state: "invalid"; httpStatus: number; message: string }
  | { state: "ok"; project: CanvasProjectFile; mtimeMs: number };

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/** 区分不存在、JSON 解析失败、校验失败。调用方决定要不要取消回收。 */
export async function readCanvasFile(filePath: string): Promise<ReadCanvasFileResult> {
  let text: string;
  let mtimeMs: number;
  try {
    const [raw, info] = await Promise.all([readFile(filePath, "utf8"), stat(filePath)]);
    text = raw;
    mtimeMs = info.mtimeMs;
  } catch (err) {
    if (isErrno(err, "ENOENT")) {
      return { state: "missing" };
    }
    return { state: "invalid", httpStatus: 400, message: USER_FACING.schemaVersionUnsupported };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripBom(text));
  } catch {
    return { state: "parse-error" };
  }
  const validated = validateProject(parsed);
  if (isIssue(validated)) {
    return { state: "invalid", httpStatus: validated.httpStatus, message: validated.message };
  }
  return { state: "ok", project: validated.project, mtimeMs };
}
