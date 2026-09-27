/**
 * 方案第 9.5 节：只吃入队快照填 API prompt。
 * 媒体先读库再 upload，返回名写入对应 input，禁止用 hash 冒充文件名。
 * 空 order 不绑不传。
 */
import { USER_FACING, type RecipeFile, type SlotRole } from "@canvas/schema";
import type { SlotSnapshot } from "./planRun.ts";

export type BindRecipeInput = {
  recipe: RecipeFile;
  slots: readonly SlotSnapshot[];
  params: Record<string, string | number | boolean | null>;
  seedUsed: number;
  uploadImage: (bytes: Uint8Array, mime: string) => Promise<string>;
  readMedia: (relativePath: string) => Promise<Uint8Array>;
};

export type BindRecipeResult =
  | { ok: true; prompt: Record<string, { class_type: string; inputs: Record<string, unknown> }> }
  | { ok: false; message: string };

function slotsOf(slots: readonly SlotSnapshot[], role: SlotRole): SlotSnapshot[] {
  return slots.filter((slot) => slot.role === role).sort((a, b) => a.order - b.order);
}

function slotAt(slots: readonly SlotSnapshot[], role: SlotRole, order: number): SlotSnapshot | undefined {
  return slots.find((slot) => slot.role === role && slot.order === order);
}

export async function bindRecipe(input: BindRecipeInput): Promise<BindRecipeResult> {
  const comfy = input.recipe.comfy;
  if (comfy === undefined) {
    return { ok: false, message: USER_FACING.recipeNotFound };
  }
  const prompt = structuredClone(comfy.prompt);
  for (const binding of comfy.bindings) {
    const target = prompt[binding.to.nodeId];
    if (target === undefined) {
      continue;
    }
    if (binding.from.kind === "param") {
      const key = binding.from.key;
      const value = key === "seed" ? input.seedUsed : key !== undefined ? (input.params[key] ?? null) : null;
      target.inputs[binding.to.input] = value;
      continue;
    }
    const role = binding.from.role;
    if (role === undefined) {
      continue;
    }
    if (binding.mode === "concat") {
      const texts = slotsOf(input.slots, role)
        .map((slot) => slot.text ?? "")
        .filter((text) => text.length > 0);
      const sep = binding.separator ?? "";
      target.inputs[binding.to.input] = texts.join(sep);
      continue;
    }
    const order = binding.from.order ?? 0;
    const slot = slotAt(input.slots, role, order);
    if (slot === undefined) {
      continue;
    }
    if (role === "prompt") {
      target.inputs[binding.to.input] = slot.text ?? "";
      continue;
    }
    if (slot.contentHash == null || slot.relativePath == null || slot.relativePath.length === 0) {
      continue;
    }
    let bytes: Uint8Array;
    try {
      bytes = await input.readMedia(slot.relativePath);
    } catch {
      return { ok: false, message: USER_FACING.comfyUploadFailed };
    }
    let name: string;
    try {
      name = await input.uploadImage(bytes, "image/png");
    } catch {
      return { ok: false, message: USER_FACING.comfyUploadFailed };
    }
    if (name.length === 0 || name === slot.contentHash) {
      return { ok: false, message: USER_FACING.comfyUploadFailed };
    }
    target.inputs[binding.to.input] = name;
  }
  return { ok: true, prompt };
}
