import assert from "node:assert/strict";
import { test } from "node:test";
import { RECIPE_IMG2IMG, RECIPE_TXT2IMG, USER_FACING } from "@canvas/schema";
import { bindRecipe } from "./bindRecipe.ts";
import { loadRecipeById } from "./recipeLoader.ts";
import type { SlotSnapshot } from "./planRun.ts";

test("txt2img concat 提示词并 set seed，不 upload", async () => {
  const loaded = loadRecipeById(RECIPE_TXT2IMG);
  assert.equal(loaded.ok, true);
  if (!loaded.ok) {
    return;
  }
  const slots: SlotSnapshot[] = [
    {
      role: "prompt",
      order: 0,
      edgeId: null,
      fromNodeId: null,
      text: "一只纸船",
      contentHash: null,
      relativePath: null,
    },
  ];
  let uploads = 0;
  const bound = await bindRecipe({
    recipe: loaded.recipe,
    slots,
    params: { seed: "random" },
    seedUsed: 42,
    uploadImage: async () => {
      uploads += 1;
      return "nope.png";
    },
    readMedia: async () => new Uint8Array([1]),
  });
  assert.equal(bound.ok, true);
  if (!bound.ok) {
    return;
  }
  assert.equal(bound.prompt.positive?.inputs.text, "一只纸船");
  assert.equal(bound.prompt.sampler?.inputs.seed, 42);
  assert.equal(uploads, 0);
});

test("img2img 先 upload 再写入 load.image，不用 hash 当文件名", async () => {
  const loaded = loadRecipeById(RECIPE_IMG2IMG);
  assert.equal(loaded.ok, true);
  if (!loaded.ok) {
    return;
  }
  const hash = "ab".repeat(32);
  const slots: SlotSnapshot[] = [
    {
      role: "prompt",
      order: 0,
      edgeId: null,
      fromNodeId: null,
      text: "改这张",
      contentHash: null,
      relativePath: null,
    },
    {
      role: "source_image",
      order: 0,
      edgeId: "e",
      fromNodeId: "img",
      text: null,
      contentHash: hash,
      relativePath: `media/blobs/ab/${hash}.blob`,
    },
  ];
  const bound = await bindRecipe({
    recipe: loaded.recipe,
    slots,
    params: { seed: 7 },
    seedUsed: 7,
    uploadImage: async () => "uploaded-source.png",
    readMedia: async (rel) => {
      assert.equal(rel.includes(hash), true);
      return new Uint8Array([9, 9, 9]);
    },
  });
  assert.equal(bound.ok, true);
  if (!bound.ok) {
    return;
  }
  assert.equal(bound.prompt.load?.inputs.image, "uploaded-source.png");
  assert.notEqual(bound.prompt.load?.inputs.image, hash);
  assert.equal(bound.prompt.positive?.inputs.text, "改这张");
  assert.equal(bound.prompt.sampler?.inputs.seed, 7);
});

test("空 order 不绑不传；upload 失败不返回 prompt", async () => {
  const loaded = loadRecipeById("recipe.image.reference.fictional");
  assert.equal(loaded.ok, true);
  if (!loaded.ok) {
    return;
  }
  const hash = "cd".repeat(32);
  const slots: SlotSnapshot[] = [
    {
      role: "prompt",
      order: 0,
      edgeId: null,
      fromNodeId: null,
      text: "参考",
      contentHash: null,
      relativePath: null,
    },
    {
      role: "reference_image",
      order: 0,
      edgeId: "e0",
      fromNodeId: "img",
      text: null,
      contentHash: hash,
      relativePath: `media/blobs/cd/${hash}.blob`,
    },
  ];
  const names: string[] = [];
  const bound = await bindRecipe({
    recipe: loaded.recipe,
    slots,
    params: { seed: "random" },
    seedUsed: 1,
    uploadImage: async () => {
      names.push("ref0.png");
      return "ref0.png";
    },
    readMedia: async () => new Uint8Array([2]),
  });
  assert.equal(bound.ok, true);
  if (!bound.ok) {
    return;
  }
  assert.equal(names.length, 1);
  assert.equal(bound.prompt.ref0?.inputs.image, "ref0.png");
  assert.equal(bound.prompt.ref1?.inputs.image, "");

  const failed = await bindRecipe({
    recipe: loaded.recipe,
    slots,
    params: { seed: "random" },
    seedUsed: 1,
    uploadImage: async () => {
      throw new Error("no");
    },
    readMedia: async () => new Uint8Array([2]),
  });
  assert.equal(failed.ok, false);
  if (!failed.ok) {
    assert.equal(failed.message, USER_FACING.comfyUploadFailed);
  }
});

test("两张参考图 + 风格参考按 byOrder 写入 ref0/ref1/style0", async () => {
  const loaded = loadRecipeById("recipe.image.reference.fictional");
  assert.equal(loaded.ok, true);
  if (!loaded.ok) {
    return;
  }
  const hash = (prefix: string): string => prefix.repeat(32).slice(0, 64);
  const media = (role: "reference_image" | "style_reference", order: number, prefix: string) => ({
    role,
    order,
    edgeId: `${role}-${order}`,
    fromNodeId: `${role}-${order}`,
    text: null,
    contentHash: hash(prefix),
    relativePath: `media/blobs/${prefix.slice(0, 2)}/${hash(prefix)}.blob`,
  });
  const slots: SlotSnapshot[] = [
    {
      role: "prompt",
      order: 0,
      edgeId: null,
      fromNodeId: null,
      text: "两张参考",
      contentHash: null,
      relativePath: null,
    },
    media("reference_image", 0, "aa"),
    media("reference_image", 1, "bb"),
    media("style_reference", 0, "cc"),
  ];
  const names: string[] = [];
  const bound = await bindRecipe({
    recipe: loaded.recipe,
    slots,
    params: { seed: "random" },
    seedUsed: 4,
    uploadImage: async () => {
      const name = `up-${names.length}.png`;
      names.push(name);
      return name;
    },
    readMedia: async () => new Uint8Array([3]),
  });
  assert.equal(bound.ok, true);
  if (!bound.ok) {
    return;
  }
  assert.deepEqual(names, ["up-0.png", "up-1.png", "up-2.png"]);
  assert.equal(bound.prompt.ref0?.inputs.image, "up-0.png");
  assert.equal(bound.prompt.ref1?.inputs.image, "up-1.png");
  assert.equal(bound.prompt.ref2?.inputs.image, "");
  assert.equal(bound.prompt.style0?.inputs.image, "up-2.png");
  assert.equal(bound.prompt.char0?.inputs.image, "");
});
