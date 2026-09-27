import type { ProjectNode } from "@canvas/schema";

/** 例如「版本 2 / 共 3」。没有版本列表时不显示。 */
export function versionLabel(node: {
  versions?: ProjectNode["versions"];
  currentVersionId?: string | null;
}): string | null {
  const versions = node.versions ?? [];
  if (versions.length === 0 || node.currentVersionId == null) {
    return null;
  }
  const index = versions.findIndex((item) => item.id === node.currentVersionId);
  if (index < 0) {
    return null;
  }
  return `版本 ${index + 1} / 共 ${versions.length}`;
}
