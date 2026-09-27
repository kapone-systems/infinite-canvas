import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  LANE_CONFIG,
  listRecipes,
  parseRecipeFile,
  RECIPE_IMG2IMG,
  RECIPE_REFERENCE,
  RECIPE_TXT2IMG,
  toRecipeSummary,
  USER_FACING,
} from "./index.ts";
import type { RecipeFile, RunSnapshot } from "./index.ts";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const recipesDir = join(repoRoot, "recipes");
const txt2imgPath = join(recipesDir, "recipe.image.txt2img.fictional.json");
const img2imgPath = join(recipesDir, "recipe.image.img2img.fictional.json");
const referencePath = join(recipesDir, "recipe.image.reference.fictional.json");

function mustParse(path: string): RecipeFile {
  const raw = JSON.parse(readFileSync(path, "utf8")) as unknown;
  const parsed = parseRecipeFile(raw);
  if (!parsed.ok) {
    throw new Error(`${path}: ${parsed.message}`);
  }
  return parsed.recipe;
}

test("index 导出 parseRecipeFile / RunSnapshot / 并发字面量 1", () => {
  assert.equal(typeof parseRecipeFile, "function");
  assert.equal(LANE_CONFIG.localConcurrency, 1);
  const snapshot: RunSnapshot = {
    runId: "run-1",
    projectId: "p",
    scope: { type: "node", nodeId: "g" },
    force: false,
    state: "running",
    plan: { nodes: [], summary: "" },
    tasks: [],
    summary: "",
  };
  assert.equal(snapshot.state, "running");
});

test("虚构 txt2img 配方按 9.5 解析，含 comfy.prompt", () => {
  const raw = JSON.parse(readFileSync(txt2imgPath, "utf8")) as unknown;
  const parsed = parseRecipeFile(raw);
  assert.equal(parsed.ok, true);
  if (!parsed.ok) {
    return;
  }
  const recipe: RecipeFile = parsed.recipe;
  assert.equal(recipe.id, RECIPE_TXT2IMG);
  assert.equal(recipe.id, "recipe.image.txt2img.fictional");
  assert.equal(recipe.version, 1);
  assert.equal(recipe.title, "本地文生图（虚构配方）");
  assert.equal(recipe.capability, "image.generate");
  assert.equal(recipe.profileId, "txt2img");
  assert.equal(recipe.lane, "local");
  assert.equal(recipe.adapterId, "comfy.api-workflow");
  assert.equal(recipe.requiresSecret, false);
  assert.equal(recipe.slots[0]?.role, "prompt");
  assert.equal(recipe.comfy?.format, "comfy.api");
  assert.equal(recipe.comfy?.prompt.positive?.class_type, "FictionalPromptEncode");
  assert.ok(recipe.comfy?.prompt);
});

test("toRecipeSummary 与 listRecipes 都不含 comfy.prompt", () => {
  const raw = JSON.parse(readFileSync(txt2imgPath, "utf8")) as unknown;
  const parsed = parseRecipeFile(raw);
  assert.equal(parsed.ok, true);
  if (!parsed.ok) {
    return;
  }
  const summary = toRecipeSummary(parsed.recipe);
  assert.equal("comfy" in summary, false);
  assert.equal(JSON.stringify(summary).includes("comfy.prompt"), false);
  assert.equal(JSON.stringify(summary).includes("class_type"), false);
  const listed = JSON.stringify(listRecipes());
  assert.equal(listed.includes("comfy.prompt"), false);
  assert.equal(listed.includes("class_type"), false);
  assert.equal(listRecipes().length, 5);
  assert.equal(listRecipes().every((item) => item.enabled), true);
});

test("磁盘 img2img 配方含 mask 槽但无遮罩绑定，无 reference_image", () => {
  const recipe = mustParse(img2imgPath);
  assert.equal(recipe.id, RECIPE_IMG2IMG);
  assert.equal(recipe.title, "本地图生图（虚构配方）");
  assert.equal(recipe.capability, "image.generate");
  assert.equal(recipe.profileId, "img2img");
  assert.equal(recipe.lane, "local");
  assert.equal(recipe.adapterId, "comfy.api-workflow");
  assert.equal(recipe.requiresSecret, false);
  assert.deepEqual(recipe.slots.map((slot) => slot.role), ["prompt", "source_image", "mask"]);
  assert.equal(recipe.slots.find((slot) => slot.role === "mask")?.required, false);
  assert.equal(recipe.comfy?.format, "comfy.api");
  assert.equal(recipe.comfy?.prompt.load?.class_type, "FictionalLoadImage");
  assert.equal(recipe.comfy?.prompt.sampler?.class_type, "FictionalImg2Img");
  assert.deepEqual(recipe.comfy?.outputNodeIds, ["save"]);
  const roles = (recipe.comfy?.bindings ?? []).map((binding) => binding.from.role);
  assert.equal(roles.includes("mask"), false);
  assert.equal(roles.includes("reference_image"), false);
  assert.equal(roles.includes("source_image"), true);
  const seedBinding = recipe.comfy?.bindings.find((binding) => binding.from.kind === "param" && binding.from.key === "seed");
  assert.equal(seedBinding?.to.nodeId, "sampler");
  const summary = toRecipeSummary(recipe);
  assert.equal("comfy" in summary, false);
  assert.equal(JSON.stringify(summary).includes("comfy.prompt"), false);
});

test("磁盘 reference 配方 byOrder 绑 ref0–ref3 / style0–style3 / char0–char3", () => {
  const recipe = mustParse(referencePath);
  assert.equal(recipe.id, RECIPE_REFERENCE);
  assert.equal(recipe.title, "本地参考图生成（虚构配方）");
  assert.equal(recipe.profileId, "reference");
  assert.equal(recipe.lane, "local");
  assert.equal(recipe.requiresSecret, false);
  assert.deepEqual(recipe.slots.map((slot) => slot.role), [
    "prompt",
    "reference_image",
    "style_reference",
    "character_reference",
  ]);
  assert.equal(recipe.slots.find((slot) => slot.role === "reference_image")?.maxCount, 4);
  assert.equal(recipe.comfy?.prompt.ref0?.class_type, "FictionalLoadImage");
  assert.equal(recipe.comfy?.prompt.ref3?.class_type, "FictionalLoadImage");
  assert.equal(recipe.comfy?.prompt.style0?.class_type, "FictionalLoadImage");
  assert.equal(recipe.comfy?.prompt.char3?.class_type, "FictionalLoadImage");
  assert.equal(recipe.comfy?.prompt.sampler?.class_type, "FictionalSampler");
  assert.deepEqual(recipe.comfy?.outputNodeIds, ["save"]);
  const byOrder = (recipe.comfy?.bindings ?? []).filter((binding) => binding.mode === "byOrder");
  assert.deepEqual(
    byOrder.map((binding) => [binding.from.role, binding.from.order, binding.to.nodeId]),
    [
      ["reference_image", 0, "ref0"],
      ["reference_image", 1, "ref1"],
      ["reference_image", 2, "ref2"],
      ["reference_image", 3, "ref3"],
      ["style_reference", 0, "style0"],
      ["style_reference", 1, "style1"],
      ["style_reference", 2, "style2"],
      ["style_reference", 3, "style3"],
      ["character_reference", 0, "char0"],
      ["character_reference", 1, "char1"],
      ["character_reference", 2, "char2"],
      ["character_reference", 3, "char3"],
    ],
  );
  const summary = toRecipeSummary(recipe);
  assert.equal(JSON.stringify(summary).includes("comfy.prompt"), false);
  assert.equal(JSON.stringify(summary).includes("class_type"), false);
});

test("顶层同时有 nodes 与 links 则 RECIPE_UI_FORMAT，句子为 11.1", () => {
  const result = parseRecipeFile({
    nodes: [{ id: 1 }],
    links: [[1, 1, 0, 2, 0, "TEXT"]],
  });
  assert.equal(result.ok, false);
  if (result.ok) {
    return;
  }
  assert.equal(result.code, "RECIPE_UI_FORMAT");
  assert.equal(result.message, USER_FACING.recipeUiFormat);
  assert.equal(
    result.message,
    "这是 ComfyUI 的界面格式。本应用只接受 API 格式，并且要包在我们自己的配方里。",
  );
});

test("顶层 API prompt 字典没有 id/slots 则 RECIPE_BARE_PROMPT", () => {
  const result = parseRecipeFile({
    positive: { class_type: "FictionalPromptEncode", inputs: { text: "" } },
    save: { class_type: "FictionalSave", inputs: { images: ["positive", 0] } },
  });
  assert.equal(result.ok, false);
  if (result.ok) {
    return;
  }
  assert.equal(result.code, "RECIPE_BARE_PROMPT");
  assert.equal(result.message, USER_FACING.recipeBarePrompt);
  assert.equal(
    result.message,
    "请把 API 格式工作流放进配方的 comfy.prompt，不要单独导入一张工作流。",
  );
});
