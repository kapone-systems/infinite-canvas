/**
 * 方案第 5.7 / 12.3 节：三种 RunScope 的计划函数。独立可测。
 * 预检只 skip/400，不改 phase。下游 skip 只看 generationBadge。
 */
import {
  collectDownstream,
  fingerprintNode,
  generationBadge,
  RANDOM_SEED,
  resolvePrompt,
  resolveSlotMedia,
  USER_FACING,
  type Phase,
  type ProjectEdge,
  type ProjectNode,
  type RecipeFile,
  type RunPlan,
  type RunPlanSkipReason,
  type RunRequest,
  type SlotRole,
} from "@canvas/schema";

export type RecipeLoadFn = (
  id: string,
) => { ok: true; recipe: RecipeFile } | { ok: false; message: string };

export type SlotSnapshot = {
  role: SlotRole;
  order: number;
  edgeId: string | null;
  fromNodeId: string | null;
  text: string | null;
  contentHash: string | null;
  relativePath: string | null;
};

export type PlannedSnapshot = {
  promptText: string;
  fingerprint: string;
  params: Record<string, string | number | boolean | null>;
  recipe: RecipeFile;
  phaseBefore: Phase;
  variantCount: number;
  nodeId: string;
  slots: SlotSnapshot[];
  seeds: number[];
  usesStaleUpstream: boolean;
  dependsOnNodeIds: string[];
};

export type PlanRunOk = {
  ok: true;
  plan: RunPlan;
  runnable: PlannedSnapshot[];
};

export type PlanRunBlocked = {
  ok: false;
  message: string;
  plan: RunPlan;
};

export type PlanRunResult = PlanRunOk | PlanRunBlocked;

export type PlanRunInput = {
  request: RunRequest;
  nodes: Record<string, ProjectNode>;
  edges: Record<string, ProjectEdge>;
  loadRecipe: RecipeLoadFn;
  randomUint32?: () => number;
  /** 只在配方 requiresSecret 时调用。缺省恒为未配置，不读凭据库。 */
  secretPresent?: (ref: { providerId: string; account?: string }) => boolean;
};

function defaultRandomUint32(): number {
  return (Math.random() * 0x1_0000_0000) >>> 0;
}

export function clampVariantCount(value: number | undefined): number {
  if (!Number.isInteger(value)) {
    return 1;
  }
  return Math.min(4, Math.max(1, value as number));
}

export function allocateSeeds(
  params: Record<string, string | number | boolean | null>,
  variantCount: number,
  randomUint32: () => number = defaultRandomUint32,
): number[] {
  const raw = params.seed;
  if (raw === RANDOM_SEED || raw === undefined || raw === null || raw === "") {
    return Array.from({ length: variantCount }, () => randomUint32() >>> 0);
  }
  const n = typeof raw === "number" ? raw : Number.parseInt(String(raw), 10);
  if (!Number.isFinite(n)) {
    return Array.from({ length: variantCount }, () => randomUint32() >>> 0);
  }
  const base = n >>> 0;
  return Array.from({ length: variantCount }, (_, i) => (base + i) >>> 0);
}

function effectiveForce(request: RunRequest): boolean {
  if (request.scope.type === "downstream") {
    return false;
  }
  return request.force === true;
}

function outgoingTargets(
  sourceId: string,
  edges: Record<string, ProjectEdge>,
): string[] {
  const targets: string[] = [];
  for (const edge of Object.values(edges)) {
    if (edge.sourceNodeId === sourceId) {
      targets.push(edge.targetNodeId);
    }
  }
  return targets;
}

/** 候选生成节点之间（可穿过素材）是否已有有向环。 */
export function candidateGenerationHasCycle(
  candidateIds: readonly string[],
  nodes: Record<string, ProjectNode>,
  edges: Record<string, ProjectEdge>,
): boolean {
  const cand = new Set(candidateIds.filter((id) => nodes[id]?.kind === "generation"));
  if (cand.size === 0) {
    return false;
  }
  const adj = new Map<string, string[]>();
  for (const id of cand) {
    const nexts: string[] = [];
    const seen = new Set<string>([id]);
    const queue = [id];
    while (queue.length > 0) {
      const cur = queue.shift();
      if (cur === undefined) {
        break;
      }
      for (const next of outgoingTargets(cur, edges)) {
        if (seen.has(next)) {
          continue;
        }
        seen.add(next);
        if (cand.has(next)) {
          nexts.push(next);
        } else {
          queue.push(next);
        }
      }
    }
    adj.set(id, nexts);
  }
  const state = new Map<string, 0 | 1 | 2>();
  const dfs = (u: string): boolean => {
    state.set(u, 1);
    for (const v of adj.get(u) ?? []) {
      const s = state.get(v) ?? 0;
      if (s === 1) {
        return true;
      }
      if (s === 0 && dfs(v)) {
        return true;
      }
    }
    state.set(u, 2);
    return false;
  };
  for (const id of cand) {
    if ((state.get(id) ?? 0) === 0 && dfs(id)) {
      return true;
    }
  }
  return false;
}

export function captureSlots(
  node: ProjectNode,
  nodes: Record<string, ProjectNode>,
  edges: Record<string, ProjectEdge>,
): SlotSnapshot[] {
  const slots = node.slots ?? [];
  return slots.map((slot) => {
    const same = slots.filter((item) => item.role === slot.role).sort((a, b) => a.order - b.order);
    const localOrder = same.findIndex((item) => item.id === slot.id);
    const edge = slot.edgeId !== null ? edges[slot.edgeId] : undefined;
    if (slot.role === "prompt") {
      return {
        role: slot.role,
        order: localOrder < 0 ? slot.order : localOrder,
        edgeId: slot.edgeId,
        fromNodeId: edge?.sourceNodeId ?? null,
        text: resolvePrompt(node, nodes, edges),
        contentHash: null,
        relativePath: null,
      };
    }
    const media = resolveSlotMedia(slot, nodes, edges);
    return {
      role: slot.role,
      order: localOrder < 0 ? slot.order : localOrder,
      edgeId: slot.edgeId,
      fromNodeId: edge?.sourceNodeId ?? null,
      text: null,
      contentHash: media?.contentHash ?? null,
      relativePath: media?.relativePath ?? null,
    };
  });
}

function recipeHasRoleBinding(recipe: RecipeFile, role: SlotRole): boolean {
  return recipe.comfy?.bindings.some((binding) => binding.from.role === role) === true;
}

function durationOnAllowList(
  value: string | number | boolean | null | undefined,
  allowed: readonly number[],
): boolean {
  if (typeof value === "number" && Number.isFinite(value)) {
    return allowed.some((item) => item === value);
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!/^-?\d+(\.\d+)?$/.test(trimmed)) {
      return false;
    }
    const n = Number(trimmed);
    return Number.isFinite(n) && allowed.some((item) => item === n);
  }
  return false;
}

export function precheckInputs(
  node: ProjectNode,
  recipe: RecipeFile,
  nodes: Record<string, ProjectNode>,
  edges: Record<string, ProjectEdge>,
  secretPresent?: (ref: { providerId: string; account?: string }) => boolean,
): { ok: true } | { ok: false; message: string } {
  const maskWired = (node.slots ?? []).some((slot) => slot.role === "mask" && slot.edgeId !== null);
  if (maskWired && !recipeHasRoleBinding(recipe, "mask")) {
    return { ok: false, message: USER_FACING.slotUnsupportedMask };
  }
  const promptSpec = recipe.slots.find((slot) => slot.role === "prompt");
  if (promptSpec?.required === true) {
    const text = resolvePrompt(node, nodes, edges);
    if (text.trim().length === 0) {
      return { ok: false, message: USER_FACING.missingPrompt };
    }
  }
  const sourceSpec = recipe.slots.find((slot) => slot.role === "source_image");
  if (sourceSpec?.required === true) {
    const ok = (node.slots ?? []).some(
      (slot) => slot.role === "source_image" && resolveSlotMedia(slot, nodes, edges)?.contentHash != null,
    );
    if (!ok) {
      return { ok: false, message: USER_FACING.missingSourceImage };
    }
  }
  const refSpec = recipe.slots.find((slot) => slot.role === "reference_image");
  if (refSpec !== undefined && (refSpec.required || refSpec.minCount > 0)) {
    const count = (node.slots ?? []).filter(
      (slot) => slot.role === "reference_image" && resolveSlotMedia(slot, nodes, edges)?.contentHash != null,
    ).length;
    const need = Math.max(refSpec.minCount, refSpec.required ? 1 : 0);
    if (count < need) {
      return { ok: false, message: USER_FACING.missingReferenceImage };
    }
  }
  const cloud = recipe.cloud?.constraints;
  if (cloud !== undefined) {
    const allowed = cloud.duration.allowed;
    if (allowed !== undefined && allowed.length > 0) {
      const raw = node.params?.durationSeconds;
      if (!durationOnAllowList(raw, allowed)) {
        return { ok: false, message: USER_FACING.durationNotAllowed };
      }
    }
    if (cloud.referenceImageCount.max === 0) {
      const wired = (node.slots ?? []).some(
        (slot) => slot.role === "reference_image" && resolveSlotMedia(slot, nodes, edges)?.contentHash != null,
      );
      if (wired) {
        return { ok: false, message: USER_FACING.slotUnsupportedReference };
      }
    }
  }
  const firstSpec = recipe.slots.find((slot) => slot.role === "first_frame");
  if (firstSpec?.required === true) {
    const ok = (node.slots ?? []).some(
      (slot) => slot.role === "first_frame" && resolveSlotMedia(slot, nodes, edges)?.contentHash != null,
    );
    if (!ok) {
      return { ok: false, message: USER_FACING.missingFirstFrame };
    }
  }
  if (recipe.requiresSecret) {
    const present = secretPresent ?? (() => false);
    const providerId = recipe.providerId ?? node.secretRef?.providerId ?? "";
    const account = node.secretRef?.account ?? "default";
    if (!present({ providerId, account })) {
      return { ok: false, message: USER_FACING.secretMissing };
    }
  }
  return { ok: true };
}

export function usesStaleUpstream(
  node: ProjectNode,
  nodes: Record<string, ProjectNode>,
  edges: Record<string, ProjectEdge>,
): boolean {
  for (const slot of node.slots ?? []) {
    if (slot.edgeId === null) {
      continue;
    }
    const edge = edges[slot.edgeId];
    if (edge === undefined) {
      continue;
    }
    const source = nodes[edge.sourceNodeId];
    if (source === undefined || source.kind !== "generation") {
      continue;
    }
    const fp = fingerprintNode(source, nodes, edges);
    if (generationBadge(source, fp) === "stale") {
      return true;
    }
  }
  return false;
}

function namedGenerationIds(
  request: RunRequest,
  nodes: Record<string, ProjectNode>,
  edges: Record<string, ProjectEdge>,
): { originId: string | null; candidates: string[] } {
  if (request.scope.type === "node") {
    return { originId: request.scope.nodeId, candidates: [request.scope.nodeId] };
  }
  if (request.scope.type === "downstream") {
    return {
      originId: request.scope.nodeId,
      candidates: collectDownstream(request.scope.nodeId, nodes, edges),
    };
  }
  const named = request.scope.nodeIds.filter((id) => nodes[id]?.kind === "generation");
  return { originId: named[0] ?? null, candidates: named };
}

type PlanRow = {
  nodeId: string;
  action: "run" | "skip";
  skipReason?: RunPlanSkipReason;
  message: string;
  snapshot?: PlannedSnapshot;
};

function planOne(
  node: ProjectNode,
  request: RunRequest,
  nodes: Record<string, ProjectNode>,
  edges: Record<string, ProjectEdge>,
  loadRecipe: RecipeLoadFn,
  randomUint32: () => number,
  secretPresent?: (ref: { providerId: string; account?: string }) => boolean,
): PlanRow {
  if (node.kind !== "generation") {
    return { nodeId: node.id, action: "skip", skipReason: "text_node", message: USER_FACING.runDisabledText };
  }
  if (node.phase === "queued" || node.phase === "running") {
    return { nodeId: node.id, action: "skip", message: USER_FACING.alreadyRunning };
  }
  const recipeId = node.recipeId ?? "";
  if (recipeId.length === 0) {
    return { nodeId: node.id, action: "skip", skipReason: "recipe_rejected", message: USER_FACING.recipeNotFound };
  }
  const loaded = loadRecipe(recipeId);
  if (!loaded.ok) {
    return { nodeId: node.id, action: "skip", skipReason: "recipe_rejected", message: loaded.message };
  }
  const recipe = loaded.recipe;
  const checked = precheckInputs(node, recipe, nodes, edges, secretPresent);
  if (!checked.ok) {
    return { nodeId: node.id, action: "skip", skipReason: "missing_input", message: checked.message };
  }
  const fingerprint = fingerprintNode(node, nodes, edges);
  const badge = generationBadge(node, fingerprint);
  const force = effectiveForce(request);
  if (request.scope.type === "downstream") {
    if (badge !== "empty" && badge !== "failed" && badge !== "stale") {
      return {
        nodeId: node.id,
        action: "skip",
        skipReason: "fresh",
        message: USER_FACING.runSkippedFresh,
      };
    }
  } else if (badge === "succeeded" && !force) {
    const message =
      request.scope.type === "selection" && request.scope.nodeIds.filter((id) => nodes[id]?.kind === "generation").length > 1
        ? USER_FACING.runSkippedFresh
        : USER_FACING.runFreshConfirm;
    return { nodeId: node.id, action: "skip", skipReason: "fresh", message };
  }
  const variantCount = clampVariantCount(node.variantCount);
  const stale = usesStaleUpstream(node, nodes, edges);
  const promptText = resolvePrompt(node, nodes, edges);
  return {
    nodeId: node.id,
    action: "run",
    message: stale ? USER_FACING.runUsesStaleUpstream : USER_FACING.handingToLocalQueue,
    snapshot: {
      promptText,
      fingerprint,
      params: { ...(node.params ?? {}) },
      recipe,
      phaseBefore: node.phase ?? "idle",
      variantCount,
      nodeId: node.id,
      slots: captureSlots(node, nodes, edges),
      seeds: allocateSeeds(node.params ?? {}, variantCount, randomUint32),
      usesStaleUpstream: stale,
      dependsOnNodeIds: [],
    },
  };
}

function applySelectionDependencies(
  rows: PlanRow[],
  named: readonly string[],
  nodes: Record<string, ProjectNode>,
  edges: Record<string, ProjectEdge>,
): PlanRow[] {
  const namedSet = new Set(named);
  const byId = new Map(rows.map((row) => [row.nodeId, row]));
  for (const row of rows) {
    const deps: string[] = [];
    for (const other of named) {
      if (other === row.nodeId || !namedSet.has(other)) {
        continue;
      }
      const down = collectDownstream(other, nodes, edges);
      if (!down.includes(row.nodeId)) {
        continue;
      }
      deps.push(other);
      const parent = byId.get(other);
      if (
        parent !== undefined &&
        parent.action === "skip" &&
        (parent.skipReason === "missing_input" || parent.skipReason === "upstream_failed")
      ) {
        row.action = "skip";
        row.skipReason = "upstream_failed";
        row.message = USER_FACING.upstreamNotRun;
        row.snapshot = undefined;
      }
    }
    if (row.action === "run" && row.snapshot !== undefined) {
      row.snapshot = { ...row.snapshot, dependsOnNodeIds: deps };
    }
  }
  return rows;
}

function planSummary(rows: PlanRow[], runnable: PlannedSnapshot[]): string {
  if (runnable.length === 1 && runnable[0]?.usesStaleUpstream === true) {
    return USER_FACING.runUsesStaleUpstream;
  }
  if (runnable.length > 0) {
    return USER_FACING.handingToLocalQueue;
  }
  return rows[0]?.message ?? USER_FACING.generationFailedNoDetail;
}

export function planRun(input: PlanRunInput): PlanRunResult {
  const { request, nodes, edges, loadRecipe } = input;
  const randomUint32 = input.randomUint32 ?? defaultRandomUint32;
  const { originId, candidates } = namedGenerationIds(request, nodes, edges);
  const cycleIds =
    request.scope.type === "downstream" && originId !== null && nodes[originId]?.kind === "generation"
      ? [originId, ...candidates]
      : candidates;
  if (candidateGenerationHasCycle(cycleIds, nodes, edges)) {
    const plan: RunPlan = {
      nodes: candidates.map((nodeId) => ({
        nodeId,
        action: "skip" as const,
        skipReason: "recipe_rejected" as const,
        message: USER_FACING.cycleCannotPlan,
      })),
      summary: USER_FACING.cycleCannotPlan,
    };
    return { ok: false, message: USER_FACING.cycleCannotPlan, plan };
  }

  const rows: PlanRow[] = [];
  if (request.scope.type === "downstream" && originId !== null) {
    const origin = nodes[originId];
    if (origin !== undefined && origin.kind === "generation") {
      rows.push({
        nodeId: originId,
        action: "skip",
        skipReason: "fresh",
        message: USER_FACING.runDownstreamOriginNotRerun,
      });
    } else if (origin !== undefined) {
      rows.push({
        nodeId: originId,
        action: "skip",
        skipReason: "text_node",
        message: USER_FACING.runDownstreamOriginNotRerun,
      });
    }
  }

  for (const nodeId of candidates) {
    const node = nodes[nodeId];
    if (node === undefined) {
      rows.push({
        nodeId,
        action: "skip",
        skipReason: "missing_input",
        message: USER_FACING.recipeNotFound,
      });
      continue;
    }
    rows.push(planOne(node, request, nodes, edges, loadRecipe, randomUint32, input.secretPresent));
  }

  if (request.scope.type === "selection") {
    applySelectionDependencies(rows, candidates, nodes, edges);
  }

  const toPlan = (row: PlanRow): RunPlan["nodes"][number] => ({
    nodeId: row.nodeId,
    action: row.action,
    skipReason: row.skipReason,
    message: row.message,
  });
  const runnable = rows
    .filter((row) => row.action === "run" && row.snapshot !== undefined)
    .map((row) => row.snapshot as PlannedSnapshot);
  const plan: RunPlan = {
    nodes: rows.map(toPlan),
    summary: planSummary(rows, runnable),
  };

  if (runnable.length > 0) {
    return { ok: true, plan, runnable };
  }

  const namedGens = candidates.filter((id) => nodes[id]?.kind === "generation");
  const skipRows = rows.filter((row) => namedGens.includes(row.nodeId) || request.scope.type !== "downstream");
  const freshSkips = skipRows.filter((row) => row.skipReason === "fresh");
  const firstMessage = rows.find((row) => row.action === "skip")?.message ?? USER_FACING.generationFailedNoDetail;

  if (request.scope.type === "downstream") {
    return { ok: true, plan, runnable: [] };
  }
  if (request.scope.type === "selection" && namedGens.length > 1 && freshSkips.length === namedGens.length) {
    return { ok: false, message: USER_FACING.runSkippedFresh, plan };
  }
  return { ok: false, message: firstMessage, plan };
}
