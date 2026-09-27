import type {
  Camera,
  CanvasProjectFile,
  MediaRef,
  Phase,
  ProjectEdge,
  ProjectGroup,
  ProjectNode,
  Slot,
  SlotRole,
  Variant,
} from "@canvas/schema";
import {
  addableRoles,
  capabilityByProfileId,
  DEFAULT_NODE_SIZE,
  defaultParamsFromRecipe,
  enabledRecipeForProfile,
  slotsFromDescriptor,
  USER_FACING,
  videoPreviewPending,
} from "@canvas/schema";
import { DEFAULT_CAMERA } from "./coords.ts";
import {
  COPY_OFFSET,
  GENERATION_WIDTH,
  generationNodeHeight,
} from "./metrics.ts";

export type EditorDocument = CanvasProjectFile;

export type CreateGenerationNodeInput = {
  profileId: string;
  idFactory: () => string;
  id?: string;
  title: string;
  x: number;
  y: number;
  z: number;
  now: Date;
  groupId?: string | null;
  promptEdgeId?: string | null;
};

export function currentVersionVariants(node: ProjectNode): Variant[] {
  const versionId = node.currentVersionId;
  if (versionId == null || node.versions === undefined) {
    return [];
  }
  const version = node.versions.find((item) => item.id === versionId);
  return version?.variants ?? [];
}

export function variantStripCount(node: ProjectNode): number {
  return currentVersionVariants(node).length;
}

export function findVariant(
  node: ProjectNode,
  variantId: string,
): { versionId: string; variant: Variant } | null {
  for (const version of node.versions ?? []) {
    const variant = version.variants.find((item) => item.id === variantId);
    if (variant !== undefined) {
      return { versionId: version.id, variant };
    }
  }
  return null;
}

export function generationHeightFor(node: Pick<ProjectNode, "slots" | "currentVersionId" | "versions">): number {
  return generationNodeHeight(node.slots?.length ?? 0, variantStripCount(node as ProjectNode));
}

export function hasPromptEdge(node: ProjectNode): boolean {
  return (node.slots ?? []).some((slot) => slot.role === "prompt" && slot.edgeId !== null);
}

export function addableRolesForNode(node: ProjectNode): SlotRole[] {
  if (node.kind !== "generation" || node.profileId == null) {
    return [];
  }
  const descriptor = capabilityByProfileId(node.profileId);
  if (descriptor === null) {
    return [];
  }
  return addableRoles(descriptor, node.slots ?? []);
}

export function reindexSlots(slots: readonly Slot[]): Slot[] {
  return slots
    .slice()
    .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
    .map((slot, index) => ({ ...slot, order: index }));
}

export function generationPreviewText(node: ProjectNode): string | null {
  const activeId = node.activeVariantId;
  if (activeId != null) {
    const found = findVariant(node, activeId);
    if (found?.variant.phase === "failed") {
      const message = found.variant.error?.message;
      if (message !== undefined && message !== "") {
        return message;
      }
      return USER_FACING.generationFailedNoDetail;
    }
  }
  if (node.output == null && node.outputText == null) {
    const failed = currentVersionVariants(node).find((item) => item.phase === "failed");
    if (failed !== undefined) {
      const message = failed.error?.message;
      if (message !== undefined && message !== "") {
        return message;
      }
      return USER_FACING.generationFailedNoDetail;
    }
  }
  return null;
}

/** 视频原片在、封面或代理未齐时的预览主句。图片无缩略图不走这里。 */
export function generationPreviewMain(node: ProjectNode): string | null {
  if (videoPreviewPending(node)) {
    return USER_FACING.previewPending;
  }
  return generationPreviewText(node);
}

export function canExtractVariant(variant: Variant): boolean {
  if (variant.phase === "queued" || variant.phase === "running") {
    return false;
  }
  if (variant.phase !== "succeeded") {
    return false;
  }
  if (variant.output !== null && variant.output !== undefined) {
    return variant.output.contentHash != null || variant.output.relativePath !== "";
  }
  return variant.text != null && variant.text !== "";
}

/**
 * 按能力描述符 minCount 建槽，并贴该 profile 唯一 enabled&&implemented 配方。
 * 不要再用演示预设当第二套槽规则。
 */
export function createGenerationNode(input: CreateGenerationNodeInput): ProjectNode | null {
  const descriptor = capabilityByProfileId(input.profileId);
  if (descriptor === null) {
    return null;
  }
  const recipe = enabledRecipeForProfile(input.profileId);
  const iso = input.now.toISOString();
  const id = input.id ?? input.idFactory();
  const slots = slotsFromDescriptor(descriptor, input.idFactory);
  if (input.promptEdgeId != null) {
    const prompt = slots.find((slot) => slot.role === "prompt");
    if (prompt !== undefined) {
      prompt.edgeId = input.promptEdgeId;
    }
  }
  const params = recipe !== null ? defaultParamsFromRecipe(recipe) : { seed: "random" };
  const secretRef =
    recipe !== null && recipe.requiresSecret && recipe.providerId !== undefined
      ? { providerId: recipe.providerId, account: "default" }
      : null;
  return {
    id,
    kind: "generation",
    title: input.title,
    x: input.x,
    y: input.y,
    z: input.z,
    width: GENERATION_WIDTH,
    height: generationNodeHeight(slots.length, 0),
    groupId: input.groupId ?? null,
    origin: "authored",
    createdAt: iso,
    updatedAt: iso,
    outputRevision: 1,
    promptDraft: "",
    capabilityId: descriptor.kind,
    profileId: descriptor.profileId,
    recipeId: recipe?.id ?? null,
    recipeVersion: recipe?.version ?? null,
    outputKind: descriptor.outputs[0],
    params,
    variantCount: 1,
    slots,
    phase: "idle",
    freshness: "fresh",
    secretRef,
  };
}

export function createDetachedMediaNode(input: {
  id: string;
  title: string;
  x: number;
  y: number;
  z: number;
  now: Date;
  media: MediaRef;
  provenance: { sourceNodeId: string; versionId: string; variantId: string };
}): ProjectNode {
  const iso = input.now.toISOString();
  const aspect =
    input.media.width != null && input.media.height != null && input.media.width > 0
      ? input.media.height / input.media.width
      : 1;
  const width = DEFAULT_NODE_SIZE.image.width;
  const height = Math.max(DEFAULT_NODE_SIZE.image.minHeight, Math.round(width * aspect));
  return {
    id: input.id,
    kind: input.media.kind,
    title: input.title,
    x: input.x,
    y: input.y,
    z: input.z,
    width,
    height,
    groupId: null,
    origin: "detached",
    createdAt: iso,
    updatedAt: iso,
    outputRevision: 1,
    output: structuredClone(input.media),
    provenance: input.provenance,
  };
}

export function createImportedImageNode(input: {
  id: string;
  title: string;
  x: number;
  y: number;
  z: number;
  now: Date;
  media: MediaRef;
}): ProjectNode {
  const iso = input.now.toISOString();
  const aspect =
    input.media.width != null && input.media.height != null && input.media.width > 0
      ? input.media.height / input.media.width
      : 1;
  const width = DEFAULT_NODE_SIZE.image.width;
  const height = Math.max(DEFAULT_NODE_SIZE.image.minHeight, Math.round(width * aspect));
  return {
    id: input.id,
    kind: "image",
    title: input.title,
    x: input.x,
    y: input.y,
    z: input.z,
    width,
    height,
    groupId: null,
    origin: "imported",
    createdAt: iso,
    updatedAt: iso,
    outputRevision: 1,
    output: structuredClone(input.media),
    provenance: null,
  };
}

export function createImportedVideoNode(input: {
  id: string;
  title: string;
  x: number;
  y: number;
  z: number;
  now: Date;
  media: MediaRef;
}): ProjectNode {
  const iso = input.now.toISOString();
  return {
    id: input.id,
    kind: "video",
    title: input.title,
    x: input.x,
    y: input.y,
    z: input.z,
    width: DEFAULT_NODE_SIZE.video.width,
    height: DEFAULT_NODE_SIZE.video.minHeight,
    groupId: null,
    origin: "imported",
    createdAt: iso,
    updatedAt: iso,
    outputRevision: 1,
    output: structuredClone(input.media),
    provenance: null,
  };
}

export function createImportedAudioNode(input: {
  id: string;
  title: string;
  x: number;
  y: number;
  z: number;
  now: Date;
  media: MediaRef;
}): ProjectNode {
  const iso = input.now.toISOString();
  return {
    id: input.id,
    kind: "audio",
    title: input.title,
    x: input.x,
    y: input.y,
    z: input.z,
    width: DEFAULT_NODE_SIZE.audio.width,
    height: DEFAULT_NODE_SIZE.audio.height,
    groupId: null,
    origin: "imported",
    createdAt: iso,
    updatedAt: iso,
    outputRevision: 1,
    output: structuredClone(input.media),
    provenance: null,
  };
}

export function isProjectEmpty(project: CanvasProjectFile): boolean {
  return Object.keys(project.nodes).length === 0;
}

export function isContentUnsaved(project: CanvasProjectFile): boolean {
  return project.contentRevision !== project.savedContentRevision;
}

export function cameraOf(project: CanvasProjectFile): Camera {
  return project.viewport ?? DEFAULT_CAMERA;
}

export function maxNodeZ(nodes: Record<string, ProjectNode>): number {
  let max = 0;
  for (const node of Object.values(nodes)) {
    if (node.z > max) {
      max = node.z;
    }
  }
  return max;
}

export function createAuthoredTextNode(input: {
  id: string;
  title: string;
  x: number;
  y: number;
  z: number;
  now: Date;
  text?: string;
  groupId?: string | null;
}): ProjectNode {
  const iso = input.now.toISOString();
  return {
    id: input.id,
    kind: "text",
    title: input.title,
    x: input.x,
    y: input.y,
    width: DEFAULT_NODE_SIZE.text.width,
    height: DEFAULT_NODE_SIZE.text.height,
    z: input.z,
    groupId: input.groupId ?? null,
    origin: "authored",
    createdAt: iso,
    updatedAt: iso,
    outputRevision: 1,
    text: input.text ?? "",
  };
}

/** 夹具仍走文生图 + 提示词线；槽规则来自工厂，不是演示预设。 */
export function createEmptyGenerationShell(input: {
  id: string;
  title: string;
  x: number;
  y: number;
  z: number;
  now: Date;
  slotId: string;
  edgeId?: string | null;
  groupId?: string | null;
}): ProjectNode {
  const node = createGenerationNode({
    profileId: "txt2img",
    idFactory: () => input.slotId,
    id: input.id,
    title: input.title,
    x: input.x,
    y: input.y,
    z: input.z,
    now: input.now,
    groupId: input.groupId,
    promptEdgeId: input.edgeId ?? null,
  });
  if (node === null) {
    throw new Error("txt2img descriptor missing");
  }
  return node;
}

export function textNodeCount(nodes: Record<string, ProjectNode>): number {
  let count = 0;
  for (const node of Object.values(nodes)) {
    if (node.kind === "text") {
      count += 1;
    }
  }
  return count;
}

export function generationNodeCount(nodes: Record<string, ProjectNode>): number {
  let count = 0;
  for (const node of Object.values(nodes)) {
    if (node.kind === "generation") {
      count += 1;
    }
  }
  return count;
}

export function edgesWithBothEndsIn(
  edges: Record<string, ProjectEdge>,
  nodeIds: ReadonlySet<string> | readonly string[],
): ProjectEdge[] {
  const set = nodeIds instanceof Set ? nodeIds : new Set(nodeIds);
  return Object.values(edges).filter(
    (edge) => set.has(edge.sourceNodeId) && set.has(edge.targetNodeId),
  );
}

export function expandSelectionToNodes(
  nodes: Record<string, ProjectNode>,
  groups: Record<string, ProjectGroup>,
  selectedIds: readonly string[],
): string[] {
  const out = new Set<string>();
  for (const id of selectedIds) {
    const group = groups[id];
    if (group !== undefined) {
      for (const child of group.childIds) {
        out.add(child);
      }
      continue;
    }
    if (nodes[id] !== undefined) {
      out.add(id);
    }
  }
  return [...out];
}

/** 点在已选分组的成员上时保持成组选择，拖组才能跟手。 */
export function selectionContainsNode(
  nodes: Record<string, ProjectNode>,
  groups: Record<string, ProjectGroup>,
  selectedIds: readonly string[],
  nodeId: string,
): boolean {
  if (selectedIds.includes(nodeId)) {
    return true;
  }
  return expandSelectionToNodes(nodes, groups, selectedIds).includes(nodeId);
}

function resetCopiedExecution(node: ProjectNode): ProjectNode {
  const next: ProjectNode = structuredClone(node);
  const phase: Phase | undefined = next.phase;
  if (phase === "queued" || phase === "running") {
    next.phase = "idle";
    next.progress = null;
    next.lastRunId = null;
    next.lastTaskId = null;
    next.runner = null;
  }
  return next;
}

export type PasteClone = {
  nodes: Record<string, ProjectNode>;
  edges: Record<string, ProjectEdge>;
  groups: Record<string, ProjectGroup>;
  nodeIdMap: Record<string, string>;
  newNodeIds: string[];
};

/**
 * 粘贴内部：新 id、偏移 COPY_OFFSET、只复制两端都在集合里的边。
 * 排队 / 运行态不继承任务。
 */
export function cloneSubgraphForPaste(input: {
  nodes: Record<string, ProjectNode>;
  edges: Record<string, ProjectEdge>;
  groups: Record<string, ProjectGroup>;
  selectedIds: readonly string[];
  idFactory: () => string;
  offset?: { x: number; y: number };
}): PasteClone {
  const offset = input.offset ?? { x: COPY_OFFSET, y: COPY_OFFSET };
  const selected = new Set(
    expandSelectionToNodes(input.nodes, input.groups, input.selectedIds),
  );

  const nodeIdMap: Record<string, string> = {};
  const slotIdMap: Record<string, string> = {};
  const nodes: Record<string, ProjectNode> = {};
  const newNodeIds: string[] = [];

  for (const id of selected) {
    const src = input.nodes[id];
    if (src === undefined) {
      continue;
    }
    const newId = input.idFactory();
    nodeIdMap[id] = newId;
    newNodeIds.push(newId);
    const copy = resetCopiedExecution(src);
    copy.id = newId;
    copy.x = src.x + offset.x;
    copy.y = src.y + offset.y;
    copy.groupId = null;
    if (copy.slots !== undefined) {
      copy.slots = copy.slots.map((slot: Slot) => {
        const newSlotId = input.idFactory();
        slotIdMap[slot.id] = newSlotId;
        return { ...slot, id: newSlotId, edgeId: null };
      });
    }
    nodes[newId] = copy;
  }

  const edges: Record<string, ProjectEdge> = {};
  for (const edge of edgesWithBothEndsIn(input.edges, selected)) {
    const sourceNodeId = nodeIdMap[edge.sourceNodeId];
    const targetNodeId = nodeIdMap[edge.targetNodeId];
    const targetSlotId = slotIdMap[edge.targetSlotId];
    if (sourceNodeId === undefined || targetNodeId === undefined || targetSlotId === undefined) {
      continue;
    }
    const newEdgeId = input.idFactory();
    edges[newEdgeId] = {
      ...edge,
      id: newEdgeId,
      sourceNodeId,
      targetNodeId,
      targetSlotId,
    };
    const target = nodes[targetNodeId];
    if (target?.slots !== undefined) {
      target.slots = target.slots.map((slot) =>
        slot.id === targetSlotId ? { ...slot, edgeId: newEdgeId } : slot,
      );
    }
  }

  const groups: Record<string, ProjectGroup> = {};
  for (const group of Object.values(input.groups)) {
    const mappedChildren = group.childIds
      .map((id) => nodeIdMap[id])
      .filter((id): id is string => id !== undefined);
    if (mappedChildren.length < 2) {
      continue;
    }
    const wasSelected = input.selectedIds.includes(group.id);
    const allChildrenSelected = group.childIds.every((id) => selected.has(id));
    if (!wasSelected && !allChildrenSelected) {
      continue;
    }
    const newGroupId = input.idFactory();
    groups[newGroupId] = {
      id: newGroupId,
      title: group.title,
      childIds: mappedChildren,
    };
    for (const childId of mappedChildren) {
      const child = nodes[childId];
      if (child !== undefined) {
        child.groupId = newGroupId;
      }
    }
  }

  return { nodes, edges, groups, nodeIdMap, newNodeIds };
}
