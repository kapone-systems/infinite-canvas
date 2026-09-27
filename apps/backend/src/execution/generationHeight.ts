/**
 * 与 apps/web/src/canvas/metrics.ts 同一套公式。后端落地写 height，补丁不含 x/y。
 */
const HEADER = 40;
const SLOT_ROW = 36;
const ADD_SLOT_ROW = 28;
const PREVIEW_MIN = 120;
const VARIANT_STRIP = 72;
const PAD = 8;

export function generationNodeHeight(slotCount: number, variantCount: number): number {
  const variantStrip = variantCount === 0 ? 0 : VARIANT_STRIP;
  return HEADER + slotCount * SLOT_ROW + ADD_SLOT_ROW + PREVIEW_MIN + variantStrip + PAD;
}

export function generationHeightFor(node: {
  slots?: readonly unknown[] | undefined;
  versions?: ReadonlyArray<{ id: string; variants: readonly unknown[] }>;
  currentVersionId?: string | null;
}): number {
  const versionId = node.currentVersionId;
  let variantCount = 0;
  if (versionId != null && node.versions !== undefined) {
    const version = node.versions.find((item) => item.id === versionId);
    variantCount = version?.variants.length ?? 0;
  }
  return generationNodeHeight(node.slots?.length ?? 0, variantCount);
}
