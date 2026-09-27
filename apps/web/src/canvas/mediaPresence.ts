import type { ProjectNode } from "@canvas/schema";
import { COPY } from "../ui/copy.ts";

/** 打开的文档引用的 blob 不在磁盘上。次句只有正斜杠相对路径，不写进工程 JSON。 */
export function mediaMissingPath(
  node: ProjectNode,
  missing: ReadonlySet<string>,
): string | null {
  const path = node.output?.relativePath;
  if (typeof path !== "string" || path.length === 0) {
    return null;
  }
  return missing.has(path) ? path : null;
}

export function mediaMissingPrimary(): typeof COPY.mediaMissing {
  return COPY.mediaMissing;
}
