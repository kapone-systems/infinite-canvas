/**
 * 二十 / 一百 / 一千远节点生成器，以及重叠夹具、复制内部边夹具。
 * 相同种子 + 相同下标得到相同世界坐标。生成节点走 createGenerationNode 工厂。
 */
import type {
  CanvasProjectFile,
  ProjectEdge,
  ProjectGroup,
  ProjectNode,
} from "@canvas/schema";
import { createEmptyProject, DEFAULT_NODE_SIZE } from "@canvas/schema";
import type { EditorStore } from "../canvas/EditorStore.ts";
import { createGenerationNode, generationHeightFor } from "../canvas/document.ts";
import {
  GENERATION_HEADER,
  GENERATION_SLOT_ROW,
  LOD_NEAR,
} from "../canvas/metrics.ts";
import { fixtureImageMediaRef, freshGeneratedMediaRef } from "./media.ts";

export const DEFAULT_FIXTURE_SEED = 20260924;
/** 正式构建不得出现这句加载入口。 */
export const LOAD_THOUSAND_LABEL = "加载 1000 个测试节点";
export const FIXTURE_NOW_ISO = "2026-09-24T00:00:00.000Z";
export const FAR_COUNTS = [20, 100, 1000] as const;
export type FarCount = (typeof FAR_COUNTS)[number];

/** 二十 / 一百默认近景（≥ LOD_NEAR）；一千远 < 0.3。一百走 P4，加载后即挂外壳与缩略图票据。 */
export const FAR_ZOOM: Record<FarCount, number> = {
  20: 1,
  100: LOD_NEAR,
  1000: 0.12,
};

const FAR_GRID_COLUMNS = 40;
const FAR_PITCH_X = 400;
const FAR_PITCH_Y = 300;

/** 阶段 2 夹具仍用文生图 + 提示词线；槽规则走工厂。 */

export function farNodeId(index: number): string {
  return `far-${index}`;
}

function mixSeed(seed: number, index: number): number {
  return (Math.imul(seed, 0x9e3779b1) ^ Math.imul(index + 1, 0x85ebca6b)) >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 位置只由 (seed, index) 决定，与夹具规模无关。 */
export function farNodePosition(index: number, seed: number): { x: number; y: number } {
  const rng = mulberry32(mixSeed(seed, index));
  const col = index % FAR_GRID_COLUMNS;
  const row = Math.floor(index / FAR_GRID_COLUMNS);
  const dx = Math.floor(rng() * 33) - 16;
  const dy = Math.floor(rng() * 33) - 16;
  return { x: col * FAR_PITCH_X + dx, y: row * FAR_PITCH_Y + dy };
}

export function farNodeKind(index: number): "text" | "generation" | "image" {
  switch (index % 5) {
    case 0:
    case 1:
      return "text";
    case 2:
    case 3:
      return "generation";
    default:
      return "image";
  }
}

function previousTextIndex(index: number): number | null {
  for (let i = index - 1; i >= 0; i -= 1) {
    if (farNodeKind(i) === "text") {
      return i;
    }
  }
  return null;
}

function authoredTextNode(input: {
  id: string;
  title: string;
  text: string;
  x: number;
  y: number;
  z: number;
  groupId: string | null;
}): ProjectNode {
  return {
    id: input.id,
    kind: "text",
    title: input.title,
    x: input.x,
    y: input.y,
    width: DEFAULT_NODE_SIZE.text.width,
    height: DEFAULT_NODE_SIZE.text.height,
    z: input.z,
    groupId: input.groupId,
    origin: "authored",
    createdAt: FIXTURE_NOW_ISO,
    updatedAt: FIXTURE_NOW_ISO,
    outputRevision: 1,
    text: input.text,
  };
}

function emptyGenerationShell(input: {
  id: string;
  title: string;
  x: number;
  y: number;
  z: number;
  slotId: string;
  edgeId: string | null;
  groupId: string | null;
}): ProjectNode {
  const node = createGenerationNode({
    profileId: "txt2img",
    idFactory: () => input.slotId,
    id: input.id,
    title: input.title,
    x: input.x,
    y: input.y,
    z: input.z,
    now: new Date(FIXTURE_NOW_ISO),
    groupId: input.groupId,
    promptEdgeId: input.edgeId,
  });
  if (node === null) {
    throw new Error("txt2img descriptor missing");
  }
  return node;
}

function importedImageNode(input: {
  id: string;
  title: string;
  x: number;
  y: number;
  z: number;
  groupId: string | null;
}): ProjectNode {
  return {
    id: input.id,
    kind: "image",
    title: input.title,
    x: input.x,
    y: input.y,
    width: DEFAULT_NODE_SIZE.image.width,
    height: DEFAULT_NODE_SIZE.image.width,
    z: input.z,
    groupId: input.groupId,
    origin: "imported",
    createdAt: FIXTURE_NOW_ISO,
    updatedAt: FIXTURE_NOW_ISO,
    outputRevision: 1,
    output: fixtureImageMediaRef(),
  };
}

function withFreshGeneratedThumb(node: ProjectNode): ProjectNode {
  const media = freshGeneratedMediaRef();
  const versionId = `${node.id}-fresh-version`;
  const variantId = `${node.id}-fresh-variant`;
  const versions = [
    {
      id: versionId,
      createdAt: FIXTURE_NOW_ISO,
      fingerprint: "fresh-generated",
      recipeId: node.recipeId ?? "",
      recipeVersion: node.recipeVersion ?? 1,
      paramSnapshot: {},
      variantCountRequested: 1,
      variants: [
        {
          id: variantId,
          index: 0,
          phase: "succeeded" as const,
          seedUsed: 1,
          output: media,
          text: null,
          error: null,
          createdAt: FIXTURE_NOW_ISO,
        },
      ],
    },
  ];
  return {
    ...node,
    versions,
    currentVersionId: versionId,
    activeVariantId: variantId,
    output: media,
    outputText: null,
    phase: "succeeded",
    freshness: "fresh",
    outputRevision: node.outputRevision + 1,
    height: generationHeightFor({
      slots: node.slots,
      versions,
      currentVersionId: versionId,
    }),
    updatedAt: FIXTURE_NOW_ISO,
  };
}

function wrapGraph(input: {
  projectId: string;
  name: string;
  nodes: Record<string, ProjectNode>;
  edges: Record<string, ProjectEdge>;
  groups: Record<string, ProjectGroup>;
  zoom: number;
}): CanvasProjectFile {
  const project = createEmptyProject({
    projectId: input.projectId,
    name: input.name,
    now: new Date(FIXTURE_NOW_ISO),
  });
  const list = Object.values(input.nodes);
  let minX = 0;
  let minY = 0;
  let maxX = 0;
  let maxY = 0;
  if (list.length > 0) {
    minX = Math.min(...list.map((node) => node.x));
    minY = Math.min(...list.map((node) => node.y));
    maxX = Math.max(...list.map((node) => node.x + node.width));
    maxY = Math.max(...list.map((node) => node.y + node.height));
  }
  project.nodes = input.nodes;
  project.edges = input.edges;
  project.groups = input.groups;
  project.nextSerial = list.length + 1;
  project.viewport = {
    x: (minX + maxX) / 2,
    y: (minY + maxY) / 2,
    zoom: input.zoom,
  };
  return project;
}

export function generateFarFixture(
  count: FarCount,
  seed: number = DEFAULT_FIXTURE_SEED,
): CanvasProjectFile {
  const nodes: Record<string, ProjectNode> = {};
  const edges: Record<string, ProjectEdge> = {};

  for (let index = 0; index < count; index += 1) {
    const id = farNodeId(index);
    const pos = farNodePosition(index, seed);
    const kind = farNodeKind(index);
    const z = index + 1;
    if (kind === "text") {
      nodes[id] = authoredTextNode({
        id,
        title: `文本 ${index + 1}`,
        text: `夹具 ${index + 1}`,
        x: pos.x,
        y: pos.y,
        z,
        groupId: null,
      });
      continue;
    }
    if (kind === "image") {
      nodes[id] = importedImageNode({
        id,
        title: `图片 ${index + 1}`,
        x: pos.x,
        y: pos.y,
        z,
        groupId: null,
      });
      continue;
    }
    const srcIndex = previousTextIndex(index);
    const slotId = `${id}-slot-0`;
    const edgeId = srcIndex === null ? null : `far-edge-${srcIndex}-${index}`;
    nodes[id] = emptyGenerationShell({
      id,
      title: `生成 ${index + 1}`,
      x: pos.x,
      y: pos.y,
      z,
      slotId,
      edgeId,
      groupId: null,
    });
    if (srcIndex !== null && edgeId !== null) {
      edges[edgeId] = {
        id: edgeId,
        sourceNodeId: farNodeId(srcIndex),
        targetNodeId: id,
        targetSlotId: slotId,
        role: "prompt",
      };
    }
  }

  if (count === 100) {
    const freshId = farNodeId(2);
    const freshNode = nodes[freshId];
    if (freshNode !== undefined && freshNode.kind === "generation") {
      nodes[freshId] = withFreshGeneratedThumb(freshNode);
    }
  }

  return wrapGraph({
    projectId: `fixture-far-${count}`,
    name: count === 1000 ? "一千远夹具" : `${count} 夹具`,
    nodes,
    edges,
    groups: {},
    zoom: FAR_ZOOM[count],
  });
}

export function generateTwentyFixture(seed: number = DEFAULT_FIXTURE_SEED): CanvasProjectFile {
  return generateFarFixture(20, seed);
}

export function generateHundredFixture(seed: number = DEFAULT_FIXTURE_SEED): CanvasProjectFile {
  return generateFarFixture(100, seed);
}

export function generateThousandFarFixture(seed: number = DEFAULT_FIXTURE_SEED): CanvasProjectFile {
  return generateFarFixture(1000, seed);
}

export type OverlapFixture = {
  project: CanvasProjectFile;
  overlapWorld: { x: number; y: number };
  slotId: string;
  groupId: string;
  generationNodeId: string;
  textNodeId: string;
};

/** 槽热区与分组框叠在同一世界点，命中应选中槽而不是组。 */
export function slotWorldPoint(node: ProjectNode, order: number): { x: number; y: number } {
  return {
    x: node.x,
    y: node.y + GENERATION_HEADER + order * GENERATION_SLOT_ROW + GENERATION_SLOT_ROW / 2,
  };
}

export function createOverlapFixture(): OverlapFixture {
  const generationNodeId = "overlap-gen";
  const textNodeId = "overlap-text";
  const slotId = "overlap-gen-slot-0";
  const groupId = "overlap-group";
  const gen = emptyGenerationShell({
    id: generationNodeId,
    title: "重叠生成",
    x: 100,
    y: 100,
    z: 2,
    slotId,
    edgeId: null,
    groupId,
  });
  const text = authoredTextNode({
    id: textNodeId,
    title: "重叠文本",
    text: "分组里的另一块",
    x: 500,
    y: 100,
    z: 1,
    groupId,
  });
  const group: ProjectGroup = {
    id: groupId,
    title: "重叠夹具",
    childIds: [generationNodeId, textNodeId],
  };
  const project = wrapGraph({
    projectId: "fixture-overlap",
    name: "重叠夹具",
    nodes: { [generationNodeId]: gen, [textNodeId]: text },
    edges: {},
    groups: { [groupId]: group },
    zoom: 1,
  });
  return {
    project,
    overlapWorld: slotWorldPoint(gen, 0),
    slotId,
    groupId,
    generationNodeId,
    textNodeId,
  };
}

export type CopyInternalEdgesFixture = {
  project: CanvasProjectFile;
  copyNodeIds: readonly string[];
  internalEdgeId: string;
  externalEdgeId: string;
  outsideNodeId: string;
  innerGenerationId: string;
  sourceTextId: string;
};

/** 两端都在选区里的边才复制；指向区外槽的线不跟着占槽。 */
export function edgesWithBothEndsIn(
  edges: Record<string, ProjectEdge>,
  nodeIds: readonly string[],
): string[] {
  const set = new Set(nodeIds);
  return Object.values(edges)
    .filter((edge) => set.has(edge.sourceNodeId) && set.has(edge.targetNodeId))
    .map((edge) => edge.id)
    .sort();
}

export function createCopyInternalEdgesFixture(): CopyInternalEdgesFixture {
  const sourceTextId = "copy-text";
  const innerGenerationId = "copy-gen-inner";
  const outsideNodeId = "copy-gen-outer";
  const innerSlotId = "copy-gen-inner-slot-0";
  const outerSlotId = "copy-gen-outer-slot-0";
  const internalEdgeId = "copy-edge-internal";
  const externalEdgeId = "copy-edge-external";
  const text = authoredTextNode({
    id: sourceTextId,
    title: "复制源文本",
    text: "只复制内部边",
    x: 0,
    y: 0,
    z: 1,
    groupId: null,
  });
  const inner = emptyGenerationShell({
    id: innerGenerationId,
    title: "复制内生成",
    x: 400,
    y: 0,
    z: 2,
    slotId: innerSlotId,
    edgeId: internalEdgeId,
    groupId: null,
  });
  const outer = emptyGenerationShell({
    id: outsideNodeId,
    title: "复制外生成",
    x: 400,
    y: 360,
    z: 3,
    slotId: outerSlotId,
    edgeId: externalEdgeId,
    groupId: null,
  });
  const edges: Record<string, ProjectEdge> = {
    [internalEdgeId]: {
      id: internalEdgeId,
      sourceNodeId: sourceTextId,
      targetNodeId: innerGenerationId,
      targetSlotId: innerSlotId,
      role: "prompt",
    },
    [externalEdgeId]: {
      id: externalEdgeId,
      sourceNodeId: sourceTextId,
      targetNodeId: outsideNodeId,
      targetSlotId: outerSlotId,
      role: "prompt",
    },
  };
  const project = wrapGraph({
    projectId: "fixture-copy-internal-edges",
    name: "复制内部边夹具",
    nodes: {
      [sourceTextId]: text,
      [innerGenerationId]: inner,
      [outsideNodeId]: outer,
    },
    edges,
    groups: {},
    zoom: 1,
  });
  return {
    project,
    copyNodeIds: [sourceTextId, innerGenerationId],
    internalEdgeId,
    externalEdgeId,
    outsideNodeId,
    innerGenerationId,
    sourceTextId,
  };
}

export function injectFakeVariants(store: EditorStore, nodeId?: string): boolean {
  const id = nodeId ?? store.getSnapshot().selectedIds.find((item) => store.nodeMap()[item]?.kind === "generation");
  if (id === undefined) {
    const first = Object.values(store.nodeMap()).find((node) => node.kind === "generation");
    if (first === undefined) {
      return false;
    }
    return store.injectSucceededVariants(first.id, [
      fixtureImageMediaRef(),
      fixtureImageMediaRef(),
      fixtureImageMediaRef(),
      fixtureImageMediaRef(),
    ]);
  }
  return store.injectSucceededVariants(id, [
    fixtureImageMediaRef(),
    fixtureImageMediaRef(),
    fixtureImageMediaRef(),
    fixtureImageMediaRef(),
  ]);
}

export function applyFixtureToStore(store: EditorStore, fixture: CanvasProjectFile): void {
  const current = store.getSnapshot().project;
  if (current === null) {
    store.loadProject(fixture);
    return;
  }
  store.replaceGraph({
    nodes: fixture.nodes,
    edges: fixture.edges,
    groups: fixture.groups,
  });
  if (fixture.viewport !== null) {
    store.setCamera(fixture.viewport);
  }
}

export function createFixtureLoaders(store: EditorStore): {
  loadTwenty: (seed?: number) => void;
  loadHundred: (seed?: number) => void;
  loadThousandFar: (seed?: number) => void;
  loadOverlap: () => void;
  loadCopyInternalEdges: () => void;
  injectFakeVariants: () => boolean;
} {
  return {
    loadTwenty(seed) {
      applyFixtureToStore(store, generateTwentyFixture(seed));
    },
    loadHundred(seed) {
      applyFixtureToStore(store, generateHundredFixture(seed));
    },
    loadThousandFar(seed) {
      applyFixtureToStore(store, generateThousandFarFixture(seed));
    },
    loadOverlap() {
      applyFixtureToStore(store, createOverlapFixture().project);
    },
    loadCopyInternalEdges() {
      applyFixtureToStore(store, createCopyInternalEdgesFixture().project);
    },
    injectFakeVariants() {
      return injectFakeVariants(store);
    },
  };
}
