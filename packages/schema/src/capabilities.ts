/**
 * 方案第 2 / 9.2 / 9.4 / 9.5 节能力描述符与演示配方摘要。
 * 同步 listCapabilities / listRecipes。不实现 CapabilityService 类。
 */

import { SLOT_ROLE_LABELS } from "./userFacingMessages.ts";
import type {
  CapabilityDescriptor,
  CapabilityParamSpec,
  CapabilitySlotSpec,
  RecipeSummary,
  Slot,
  SlotRole,
} from "./types.ts";
import { RANDOM_SEED } from "./types.ts";

export const RECIPE_TXT2IMG = "recipe.image.txt2img.fictional";
export const RECIPE_IMG2IMG = "recipe.image.img2img.fictional";
export const RECIPE_REFERENCE = "recipe.image.reference.fictional";
export const RECIPE_IMG2VIDEO_FIXTURE = "recipe.video.img2video.fixture";
export const RECIPE_IMG2VIDEO_NEEDS_SECRET = "recipe.video.img2video.needs-secret";

const IMAGE_PARAMS: CapabilityParamSpec[] = [
  {
    key: "seed",
    label: "种子",
    valueType: "string",
    required: true,
    userFacing: true,
    default: RANDOM_SEED,
  },
  {
    key: "width",
    label: "宽度",
    valueType: "int",
    required: false,
    userFacing: true,
    min: 256,
    max: 2048,
    default: 1024,
  },
  {
    key: "height",
    label: "高度",
    valueType: "int",
    required: false,
    userFacing: true,
    min: 256,
    max: 2048,
    default: 1024,
  },
];

const TXT2IMG_SLOTS: CapabilitySlotSpec[] = [
  { role: "prompt", minCount: 1, maxCount: 1, accepts: ["text"], required: true },
];

const IMG2IMG_SLOTS: CapabilitySlotSpec[] = [
  { role: "prompt", minCount: 1, maxCount: 1, accepts: ["text"], required: true },
  { role: "source_image", minCount: 1, maxCount: 1, accepts: ["image"], required: true },
  { role: "mask", minCount: 0, maxCount: 1, accepts: ["image"], required: false },
];

const REFERENCE_SLOTS: CapabilitySlotSpec[] = [
  { role: "prompt", minCount: 1, maxCount: 1, accepts: ["text"], required: true },
  { role: "reference_image", minCount: 1, maxCount: 4, accepts: ["image"], required: true },
  { role: "style_reference", minCount: 0, maxCount: 4, accepts: ["image"], required: false },
  { role: "character_reference", minCount: 0, maxCount: 4, accepts: ["image"], required: false },
];

const IMG2VIDEO_SLOTS: CapabilitySlotSpec[] = [
  { role: "first_frame", minCount: 1, maxCount: 1, accepts: ["image"], required: true },
  { role: "last_frame", minCount: 0, maxCount: 1, accepts: ["image"], required: false },
  { role: "prompt", minCount: 0, maxCount: 1, accepts: ["text"], required: false },
];

/** default 保持字符串 "4"，不要改成数字。allowed 在配方 cloud 段里才是数字。 */
const IMG2VIDEO_PARAMS: CapabilityParamSpec[] = [
  {
    key: "durationSeconds",
    label: "时长（秒）",
    valueType: "enum",
    required: false,
    userFacing: true,
    enumValues: ["2", "4", "8"],
    default: "4",
  },
];

const CAPABILITIES: CapabilityDescriptor[] = [
  {
    kind: "image.generate",
    profileId: "txt2img",
    displayName: "文生图",
    slots: TXT2IMG_SLOTS,
    params: IMAGE_PARAMS,
    outputs: ["image"],
    implemented: true,
  },
  {
    kind: "image.generate",
    profileId: "img2img",
    displayName: "图生图",
    slots: IMG2IMG_SLOTS,
    params: IMAGE_PARAMS,
    outputs: ["image"],
    implemented: true,
  },
  {
    kind: "image.generate",
    profileId: "reference",
    displayName: "参考图生成",
    slots: REFERENCE_SLOTS,
    params: IMAGE_PARAMS,
    outputs: ["image"],
    implemented: true,
  },
  {
    kind: "video.generate",
    profileId: "img2video",
    displayName: "图生视频",
    slots: IMG2VIDEO_SLOTS,
    params: IMG2VIDEO_PARAMS,
    outputs: ["video"],
    implemented: true,
  },
  {
    kind: "text.generate",
    profileId: "complete",
    displayName: "文生文",
    slots: [{ role: "prompt", minCount: 1, maxCount: 1, accepts: ["text"], required: true }],
    params: [],
    outputs: ["text"],
    implemented: false,
  },
  {
    kind: "video.generate",
    profileId: "txt2video",
    displayName: "文生视频",
    slots: [{ role: "prompt", minCount: 1, maxCount: 1, accepts: ["text"], required: true }],
    params: [],
    outputs: ["video"],
    implemented: false,
  },
  {
    kind: "video.lipsync",
    profileId: "talking-head",
    displayName: "对口型",
    slots: [{ role: "prompt", minCount: 1, maxCount: 1, accepts: ["text"], required: true }],
    params: [],
    outputs: ["video"],
    implemented: false,
  },
];

const RECIPES: RecipeSummary[] = [
  {
    id: RECIPE_TXT2IMG,
    version: 1,
    title: "本地文生图（虚构配方）",
    kind: "image.generate",
    profileId: "txt2img",
    lane: "local",
    implemented: true,
    enabled: true,
    requiresSecret: false,
    params: IMAGE_PARAMS,
    slots: TXT2IMG_SLOTS,
  },
  {
    id: RECIPE_IMG2IMG,
    version: 1,
    title: "本地图生图（虚构配方）",
    kind: "image.generate",
    profileId: "img2img",
    lane: "local",
    implemented: true,
    enabled: true,
    requiresSecret: false,
    params: IMAGE_PARAMS,
    slots: IMG2IMG_SLOTS,
  },
  {
    id: RECIPE_REFERENCE,
    version: 1,
    title: "本地参考图生成（虚构配方）",
    kind: "image.generate",
    profileId: "reference",
    lane: "local",
    implemented: true,
    enabled: true,
    requiresSecret: false,
    params: IMAGE_PARAMS,
    slots: REFERENCE_SLOTS,
  },
  {
    id: RECIPE_IMG2VIDEO_FIXTURE,
    version: 1,
    title: "图生视频（夹具，无厂商报文）",
    kind: "video.generate",
    profileId: "img2video",
    lane: "cloud",
    implemented: true,
    enabled: true,
    requiresSecret: false,
    params: IMG2VIDEO_PARAMS,
    slots: IMG2VIDEO_SLOTS,
  },
  {
    id: RECIPE_IMG2VIDEO_NEEDS_SECRET,
    version: 1,
    title: "图生视频（缺密钥桩，无厂商报文）",
    kind: "video.generate",
    profileId: "img2video",
    lane: "cloud",
    implemented: true,
    enabled: true,
    requiresSecret: true,
    providerId: "example.cloud",
    params: IMG2VIDEO_PARAMS,
    slots: IMG2VIDEO_SLOTS,
  },
];

export function listCapabilities(): CapabilityDescriptor[] {
  return CAPABILITIES.map((item) => ({
    ...item,
    slots: item.slots.map((slot) => ({ ...slot, accepts: [...slot.accepts] })),
    params: item.params.map((param) => ({ ...param })),
    outputs: [...item.outputs],
  }));
}

export function listRecipes(): RecipeSummary[] {
  return RECIPES.map((item) => ({
    ...item,
    slots: item.slots.map((slot) => ({ ...slot, accepts: [...slot.accepts] })),
    params: item.params.map((param) => ({ ...param })),
  }));
}

export function capabilityByProfileId(profileId: string): CapabilityDescriptor | null {
  return listCapabilities().find((item) => item.profileId === profileId) ?? null;
}

/** 该 profile 唯一 enabled && implemented 的配方；多于一张取列表第一张。 */
export function enabledRecipeForProfile(profileId: string): RecipeSummary | null {
  const matches = listRecipes().filter(
    (item) => item.profileId === profileId && item.enabled && item.implemented,
  );
  return matches[0] ?? null;
}

export function slotsFromDescriptor(
  descriptor: Pick<CapabilityDescriptor, "slots">,
  idFactory: () => string,
): Slot[] {
  const slots: Slot[] = [];
  let order = 0;
  for (const spec of descriptor.slots) {
    for (let i = 0; i < spec.minCount; i += 1) {
      slots.push({
        id: idFactory(),
        role: spec.role,
        order,
        edgeId: null,
      });
      order += 1;
    }
  }
  return slots;
}

export function addableRoles(
  descriptor: Pick<CapabilityDescriptor, "slots">,
  slots: readonly Slot[],
): SlotRole[] {
  const counts = new Map<SlotRole, number>();
  for (const slot of slots) {
    counts.set(slot.role, (counts.get(slot.role) ?? 0) + 1);
  }
  const roles: SlotRole[] = [];
  for (const spec of descriptor.slots) {
    const count = counts.get(spec.role) ?? 0;
    if (count < spec.maxCount) {
      roles.push(spec.role);
    }
  }
  return roles;
}

export function roleLabel(role: SlotRole): string {
  return SLOT_ROLE_LABELS[role];
}

/** 同角色从 1 起。 */
export function roleDisplayIndex(slots: readonly Slot[], slot: Slot): number {
  const same = slots.filter((item) => item.role === slot.role);
  same.sort((a, b) => a.order - b.order);
  const index = same.findIndex((item) => item.id === slot.id);
  return index === -1 ? 1 : index + 1;
}

export function slotTitle(slots: readonly Slot[], slot: Slot): string {
  const label = roleLabel(slot.role);
  const sameCount = slots.filter((item) => item.role === slot.role).length;
  if (sameCount <= 1) {
    return label;
  }
  return `${label} ${roleDisplayIndex(slots, slot)}`;
}

export function defaultParamsFromRecipe(
  recipe: Pick<RecipeSummary, "params">,
): Record<string, string | number | boolean | null> {
  const params: Record<string, string | number | boolean | null> = {};
  for (const spec of recipe.params) {
    if (!spec.userFacing || spec.default === undefined) {
      continue;
    }
    params[spec.key] = spec.key === "seed" && spec.default === "随机" ? RANDOM_SEED : spec.default;
  }
  return params;
}
