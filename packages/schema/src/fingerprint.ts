/**
 * 方案第 9.6 节：sha256(规范化 JSON)。
 * 内容只包括 recipeId、recipeVersion、用户参数、variantCount、槽位按 role 再按 order。
 * 文本用正文，媒体用 contentHash。坐标、标题、分组、视口不进指纹。
 * 种子存储与指纹只用 ASCII "random"。
 */

import { resolvePrompt } from "./resolvePrompt.ts";
import { resolveSlotMedia } from "./resolveSlotMedia.ts";
import { sha256Hex } from "./sha256.ts";
import type { ProjectEdge, ProjectNode, SlotRole } from "./types.ts";
import { RANDOM_SEED } from "./types.ts";

export type FingerprintSlot = {
  role: SlotRole;
  order: number;
  text: string | null;
  contentHash: string | null;
};

export type FingerprintInput = {
  recipeId: string | null;
  recipeVersion: number | null;
  params: Record<string, string | number | boolean | null>;
  variantCount: number;
  slots: FingerprintSlot[];
};

function normalizeSeedValue(value: string | number | boolean | null): string | number | boolean | null {
  if (value === "随机") {
    return RANDOM_SEED;
  }
  return value;
}

export function canonicalJson(value: unknown): string {
  if (value === null) {
    return "null";
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      return "null";
    }
    return JSON.stringify(value);
  }
  if (typeof value === "string") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  if (typeof value === "object") {
    const keys = Object.keys(value).sort();
    const parts: string[] = [];
    for (const key of keys) {
      const item = (value as Record<string, unknown>)[key];
      if (item === undefined) {
        continue;
      }
      parts.push(`${JSON.stringify(key)}:${canonicalJson(item)}`);
    }
    return `{${parts.join(",")}}`;
  }
  return "null";
}

function sortedSlots(slots: readonly FingerprintSlot[]): FingerprintSlot[] {
  return slots
    .map((slot) => ({
      contentHash: slot.contentHash,
      order: slot.order,
      role: slot.role,
      text: slot.text,
    }))
    .sort((a, b) => {
      const byRole = a.role.localeCompare(b.role);
      if (byRole !== 0) {
        return byRole;
      }
      return a.order - b.order;
    });
}

function normalizeParams(
  params: Record<string, string | number | boolean | null>,
): Record<string, string | number | boolean | null> {
  const next: Record<string, string | number | boolean | null> = {};
  const keys = Object.keys(params).sort();
  for (const key of keys) {
    const value = params[key];
    if (value === undefined) {
      continue;
    }
    next[key] = key === "seed" ? normalizeSeedValue(value) : value;
  }
  return next;
}

export function fingerprint(input: FingerprintInput): string {
  const payload = {
    params: normalizeParams(input.params),
    recipeId: input.recipeId,
    recipeVersion: input.recipeVersion,
    slots: sortedSlots(input.slots),
    variantCount: input.variantCount,
  };
  return sha256Hex(canonicalJson(payload));
}

export function fingerprintNode(
  node: ProjectNode,
  nodes: Record<string, ProjectNode>,
  edges: Record<string, ProjectEdge>,
): string {
  const slots: FingerprintSlot[] = (node.slots ?? []).map((slot) => {
    if (slot.role === "prompt") {
      return {
        role: slot.role,
        order: slot.order,
        text: resolvePrompt(node, nodes, edges),
        contentHash: null,
      };
    }
    const media = resolveSlotMedia(slot, nodes, edges);
    return {
      role: slot.role,
      order: slot.order,
      text: null,
      contentHash: media?.contentHash ?? null,
    };
  });
  return fingerprint({
    recipeId: node.recipeId ?? null,
    recipeVersion: node.recipeVersion ?? null,
    params: node.params ?? {},
    variantCount: node.variantCount ?? 1,
    slots,
  });
}
