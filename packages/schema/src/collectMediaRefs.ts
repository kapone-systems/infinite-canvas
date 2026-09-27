import { isValidProjectRelPath } from "./projectRelPath.ts";
import type { CanvasProjectFile, MediaRef } from "./types.ts";
import { MEDIA_REF_PATH_KEYS } from "./types.ts";

function isMediaRef(value: unknown): value is MediaRef {
  return value !== null && typeof value === "object" && "relativePath" in value;
}

/** 当前这一份文档里的 MediaRef：节点 output，以及每个 versions[].variants[].output。不读 autosave / bak。 */
export function collectMediaRefs(project: CanvasProjectFile): MediaRef[] {
  const refs: MediaRef[] = [];
  for (const node of Object.values(project.nodes)) {
    if (isMediaRef(node.output)) {
      refs.push(node.output);
    }
    if (node.versions === undefined) {
      continue;
    }
    for (const version of node.versions) {
      for (const variant of version.variants) {
        if (isMediaRef(variant.output)) {
          refs.push(variant.output);
        }
      }
    }
  }
  return refs;
}

/** 六键路径，外加合法正斜杠相对路径的 outputText。普通正文不算引用。 */
export function collectMediaRelPaths(project: CanvasProjectFile): Set<string> {
  const paths = new Set<string>();
  for (const ref of collectMediaRefs(project)) {
    for (const key of MEDIA_REF_PATH_KEYS) {
      const value = ref[key];
      if (typeof value === "string" && value.length > 0) {
        paths.add(value);
      }
    }
  }
  for (const node of Object.values(project.nodes)) {
    if (typeof node.outputText === "string" && isValidProjectRelPath(node.outputText)) {
      paths.add(node.outputText);
    }
  }
  return paths;
}
