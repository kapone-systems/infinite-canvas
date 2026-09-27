import type { CanvasProjectFile } from "./types.ts";
import { MEDIA_HASH_ALGORITHM, PROJECT_FORMAT, SCHEMA_VERSION } from "./types.ts";

export function createEmptyProject(input: {
  projectId: string;
  name: string;
  now?: Date;
}): CanvasProjectFile {
  const timestamp = (input.now ?? new Date()).toISOString();
  return {
    format: PROJECT_FORMAT,
    schemaVersion: SCHEMA_VERSION,
    projectId: input.projectId,
    name: input.name,
    mediaHashAlgorithm: MEDIA_HASH_ALGORITHM,
    contentRevision: 0,
    savedContentRevision: 0,
    nextSerial: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
    viewport: null,
    nodes: {},
    edges: {},
    groups: {},
  };
}
