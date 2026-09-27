/**
 * 方案第 9.5 / 12.3 节：解析安装目录配方 JSON。
 * 拒绝 ComfyUI 界面格式（顶层同时有数组 nodes 与 links）。
 * GET /recipes 仍只返回 RecipeSummary，不得带 comfy.prompt。
 */

import type {
  CapabilityKind,
  CapabilityParamSpec,
  CapabilitySlotSpec,
  CloudVideoConstraints,
  MediaKind,
  ParamValueType,
  RecipeBinding,
  RecipeBindingMode,
  RecipeComfy,
  RecipeComfyPromptNode,
  RecipeFile,
  RecipeSummary,
  SlotRole,
  TaskLane,
} from "./types.ts";
import {
  CAPABILITY_KINDS,
  COMFY_API_FORMAT,
  MEDIA_KINDS,
  PARAM_VALUE_TYPES,
  SLOT_ROLES,
  TASK_LANES,
} from "./types.ts";
import { USER_FACING } from "./userFacingMessages.ts";

export type RecipeParseCode = "RECIPE_UI_FORMAT" | "RECIPE_BARE_PROMPT" | "RECIPE_INVALID";

export type ParseRecipeResult =
  | { ok: true; recipe: RecipeFile }
  | { ok: false; code: RecipeParseCode; message: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isMember<T extends string>(value: unknown, allowed: readonly T[]): value is T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value);
}

function fail(code: RecipeParseCode, message: string): ParseRecipeResult {
  return { ok: false, code, message };
}

function looksLikeComfyApiPrompt(value: Record<string, unknown>): boolean {
  const entries = Object.values(value);
  if (entries.length === 0) {
    return false;
  }
  return entries.every((item) => {
    if (!isRecord(item)) {
      return false;
    }
    return typeof item.class_type === "string";
  });
}

function parseAccepts(value: unknown): MediaKind[] | null {
  if (!Array.isArray(value) || value.length === 0) {
    return null;
  }
  const accepts: MediaKind[] = [];
  for (const item of value) {
    if (!isMember(item, MEDIA_KINDS)) {
      return null;
    }
    accepts.push(item);
  }
  return accepts;
}

function parseSlots(value: unknown): CapabilitySlotSpec[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const slots: CapabilitySlotSpec[] = [];
  for (const item of value) {
    if (!isRecord(item)) {
      return null;
    }
    if (!isMember(item.role, SLOT_ROLES)) {
      return null;
    }
    if (!Number.isInteger(item.minCount) || (item.minCount as number) < 0) {
      return null;
    }
    if (!Number.isInteger(item.maxCount) || (item.maxCount as number) < (item.minCount as number)) {
      return null;
    }
    const accepts = parseAccepts(item.accepts);
    if (accepts === null) {
      return null;
    }
    const required = item.required === undefined ? false : item.required === true;
    if (item.required !== undefined && typeof item.required !== "boolean") {
      return null;
    }
    slots.push({
      role: item.role,
      minCount: item.minCount as number,
      maxCount: item.maxCount as number,
      accepts,
      required,
    });
  }
  return slots;
}

function parseParamDefault(
  value: unknown,
): string | number | boolean | null | undefined {
  if (value === undefined || value === null) {
    return value;
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  return undefined;
}

function parseParams(value: unknown): CapabilityParamSpec[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const params: CapabilityParamSpec[] = [];
  for (const item of value) {
    if (!isRecord(item)) {
      return null;
    }
    if (typeof item.key !== "string" || item.key.length === 0) {
      return null;
    }
    if (typeof item.label !== "string" || item.label.length === 0) {
      return null;
    }
    if (!isMember(item.valueType, PARAM_VALUE_TYPES)) {
      return null;
    }
    if (item.required !== undefined && typeof item.required !== "boolean") {
      return null;
    }
    if (item.userFacing !== undefined && typeof item.userFacing !== "boolean") {
      return null;
    }
    const spec: CapabilityParamSpec = {
      key: item.key,
      label: item.label,
      valueType: item.valueType as ParamValueType,
      required: item.required === true,
      userFacing: item.userFacing === true,
    };
    const defaultValue = parseParamDefault(item.default);
    if (item.default !== undefined && defaultValue === undefined) {
      return null;
    }
    if (defaultValue !== undefined) {
      spec.default = defaultValue;
    }
    if (item.min !== undefined) {
      if (typeof item.min !== "number" || !Number.isFinite(item.min)) {
        return null;
      }
      spec.min = item.min;
    }
    if (item.max !== undefined) {
      if (typeof item.max !== "number" || !Number.isFinite(item.max)) {
        return null;
      }
      spec.max = item.max;
    }
    if (item.enumValues !== undefined) {
      if (!Array.isArray(item.enumValues) || item.enumValues.some((entry) => typeof entry !== "string")) {
        return null;
      }
      spec.enumValues = item.enumValues as string[];
    }
    params.push(spec);
  }
  return params;
}

function parseBinding(value: unknown): RecipeBinding | null {
  if (!isRecord(value) || !isRecord(value.from) || !isRecord(value.to)) {
    return null;
  }
  if (value.from.kind !== "slot" && value.from.kind !== "param") {
    return null;
  }
  const mode = value.mode;
  if (mode !== "concat" && mode !== "set" && mode !== "byOrder") {
    return null;
  }
  if (typeof value.to.nodeId !== "string" || value.to.nodeId.length === 0) {
    return null;
  }
  if (typeof value.to.input !== "string" || value.to.input.length === 0) {
    return null;
  }
  const binding: RecipeBinding = {
    from: { kind: value.from.kind },
    to: { nodeId: value.to.nodeId, input: value.to.input },
    mode: mode as RecipeBindingMode,
  };
  if (value.from.role !== undefined) {
    if (!isMember(value.from.role, SLOT_ROLES)) {
      return null;
    }
    binding.from.role = value.from.role as SlotRole;
  }
  if (value.from.order !== undefined) {
    if (!Number.isInteger(value.from.order)) {
      return null;
    }
    binding.from.order = value.from.order as number;
  }
  if (value.from.key !== undefined) {
    if (typeof value.from.key !== "string") {
      return null;
    }
    binding.from.key = value.from.key;
  }
  if (value.separator !== undefined) {
    if (typeof value.separator !== "string") {
      return null;
    }
    binding.separator = value.separator;
  }
  return binding;
}

function parseComfy(value: unknown): RecipeComfy | null {
  if (!isRecord(value)) {
    return null;
  }
  if (value.format !== COMFY_API_FORMAT) {
    return null;
  }
  if (!isRecord(value.prompt)) {
    return null;
  }
  const prompt: Record<string, RecipeComfyPromptNode> = {};
  for (const [nodeId, node] of Object.entries(value.prompt)) {
    if (!isRecord(node) || typeof node.class_type !== "string") {
      return null;
    }
    if (!isRecord(node.inputs)) {
      return null;
    }
    prompt[nodeId] = {
      class_type: node.class_type,
      inputs: { ...node.inputs },
    };
  }
  if (!Array.isArray(value.bindings)) {
    return null;
  }
  const bindings: RecipeBinding[] = [];
  for (const item of value.bindings) {
    const binding = parseBinding(item);
    if (binding === null) {
      return null;
    }
    bindings.push(binding);
  }
  if (!Array.isArray(value.outputNodeIds) || value.outputNodeIds.some((id) => typeof id !== "string")) {
    return null;
  }
  return {
    format: COMFY_API_FORMAT,
    prompt,
    bindings,
    outputNodeIds: value.outputNodeIds as string[],
  };
}

const CLOUD_UPLOADS = ["multipart", "presigned-put", "remote-url", "inline-bytes"] as const;
const CLOUD_FRAMES = ["unsupported", "optional", "required"] as const;
const DURATION_UNITS = ["seconds", "frames"] as const;

function parseCloud(value: unknown): RecipeFile["cloud"] | null {
  if (!isRecord(value) || !isRecord(value.constraints)) {
    return null;
  }
  const c = value.constraints;
  if (!isMember(c.upload, CLOUD_UPLOADS)) {
    return null;
  }
  if (!isMember(c.firstFrame, CLOUD_FRAMES) || !isMember(c.lastFrame, CLOUD_FRAMES)) {
    return null;
  }
  if (!isRecord(c.referenceImageCount)) {
    return null;
  }
  const refMin = c.referenceImageCount.min;
  const refMax = c.referenceImageCount.max;
  if (!Number.isInteger(refMin) || !Number.isInteger(refMax)) {
    return null;
  }
  if (!isRecord(c.duration) || !isMember(c.duration.unit, DURATION_UNITS)) {
    return null;
  }
  const duration: CloudVideoConstraints["duration"] = { unit: c.duration.unit };
  if (c.duration.allowed !== undefined) {
    if (!Array.isArray(c.duration.allowed) || c.duration.allowed.some((item) => typeof item !== "number" || !Number.isFinite(item))) {
      return null;
    }
    duration.allowed = [...c.duration.allowed];
  }
  if (c.duration.min !== undefined) {
    if (typeof c.duration.min !== "number" || !Number.isFinite(c.duration.min)) {
      return null;
    }
    duration.min = c.duration.min;
  }
  if (c.duration.max !== undefined) {
    if (typeof c.duration.max !== "number" || !Number.isFinite(c.duration.max)) {
      return null;
    }
    duration.max = c.duration.max;
  }
  if (typeof c.pollIntervalMs !== "number" || !Number.isFinite(c.pollIntervalMs)) {
    return null;
  }
  if (typeof c.pollTimeoutMs !== "number" || !Number.isFinite(c.pollTimeoutMs)) {
    return null;
  }
  return {
    constraints: {
      upload: c.upload,
      firstFrame: c.firstFrame,
      lastFrame: c.lastFrame,
      referenceImageCount: { min: refMin as number, max: refMax as number },
      duration,
      pollIntervalMs: c.pollIntervalMs,
      pollTimeoutMs: c.pollTimeoutMs,
    },
  };
}

export function parseRecipeFile(input: unknown): ParseRecipeResult {
  if (!isRecord(input)) {
    return fail("RECIPE_INVALID", USER_FACING.recipeNotFound);
  }
  if (Array.isArray(input.nodes) && Array.isArray(input.links)) {
    return fail("RECIPE_UI_FORMAT", USER_FACING.recipeUiFormat);
  }
  const hasWrapper =
    typeof input.id === "string" &&
    input.id.length > 0 &&
    Array.isArray(input.slots);
  if (!hasWrapper && looksLikeComfyApiPrompt(input)) {
    return fail("RECIPE_BARE_PROMPT", USER_FACING.recipeBarePrompt);
  }
  if (typeof input.id !== "string" || input.id.length === 0) {
    return fail("RECIPE_INVALID", USER_FACING.recipeNotFound);
  }
  if (!Number.isInteger(input.version) || (input.version as number) < 1) {
    return fail("RECIPE_INVALID", USER_FACING.recipeNotFound);
  }
  if (typeof input.title !== "string" || input.title.length === 0) {
    return fail("RECIPE_INVALID", USER_FACING.recipeNotFound);
  }
  if (!isMember(input.capability, CAPABILITY_KINDS)) {
    return fail("RECIPE_INVALID", USER_FACING.recipeNotFound);
  }
  if (typeof input.profileId !== "string" || input.profileId.length === 0) {
    return fail("RECIPE_INVALID", USER_FACING.recipeNotFound);
  }
  if (!isMember(input.lane, TASK_LANES)) {
    return fail("RECIPE_INVALID", USER_FACING.recipeNotFound);
  }
  if (typeof input.adapterId !== "string" || input.adapterId.length === 0) {
    return fail("RECIPE_INVALID", USER_FACING.recipeNotFound);
  }
  if (typeof input.requiresSecret !== "boolean") {
    return fail("RECIPE_INVALID", USER_FACING.recipeNotFound);
  }
  const slots = parseSlots(input.slots);
  if (slots === null) {
    return fail("RECIPE_INVALID", USER_FACING.recipeNotFound);
  }
  const params = parseParams(input.params ?? []);
  if (params === null) {
    return fail("RECIPE_INVALID", USER_FACING.recipeNotFound);
  }
  const recipe: RecipeFile = {
    id: input.id,
    version: input.version as number,
    title: input.title,
    capability: input.capability as CapabilityKind,
    profileId: input.profileId,
    lane: input.lane as TaskLane,
    adapterId: input.adapterId,
    requiresSecret: input.requiresSecret,
    slots,
    params,
  };
  if (input.providerId !== undefined) {
    if (typeof input.providerId !== "string" || input.providerId.length === 0) {
      return fail("RECIPE_INVALID", USER_FACING.recipeNotFound);
    }
    recipe.providerId = input.providerId;
  }
  if (input.comfy !== undefined) {
    const comfy = parseComfy(input.comfy);
    if (comfy === null) {
      return fail("RECIPE_INVALID", USER_FACING.recipeNotFound);
    }
    recipe.comfy = comfy;
  }
  if (input.cloud !== undefined) {
    const cloud = parseCloud(input.cloud);
    if (cloud === null) {
      return fail("RECIPE_INVALID", USER_FACING.recipeNotFound);
    }
    recipe.cloud = cloud;
  }
  return { ok: true, recipe };
}

/** GET /recipes 形状：仅 userFacing 参数，不含 comfy.prompt。 */
export function toRecipeSummary(
  recipe: RecipeFile,
  extras?: { implemented?: boolean; enabled?: boolean; disabledReason?: string },
): RecipeSummary {
  const summary: RecipeSummary = {
    id: recipe.id,
    version: recipe.version,
    title: recipe.title,
    kind: recipe.capability,
    profileId: recipe.profileId,
    lane: recipe.lane,
    implemented: extras?.implemented ?? true,
    enabled: extras?.enabled ?? true,
    requiresSecret: recipe.requiresSecret,
    params: recipe.params.filter((param) => param.userFacing).map((param) => ({ ...param })),
    slots: recipe.slots.map((slot) => ({ ...slot, accepts: [...slot.accepts] })),
  };
  if (recipe.providerId !== undefined) {
    summary.providerId = recipe.providerId;
  }
  if (extras?.disabledReason !== undefined) {
    summary.disabledReason = extras.disabledReason;
  }
  return summary;
}
