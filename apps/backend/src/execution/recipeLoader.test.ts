import assert from "node:assert/strict";
import { chdir, cwd } from "node:process";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  LANE_CONFIG,
  listRecipes,
  parseRecipeFile,
  RECIPE_IMG2IMG,
  RECIPE_IMG2VIDEO_FIXTURE,
  RECIPE_IMG2VIDEO_NEEDS_SECRET,
  RECIPE_REFERENCE,
  RECIPE_TXT2IMG,
  toRecipeSummary,
  USER_FACING,
  type RunSnapshot,
} from "@canvas/schema";
import {
  loadInstalledRecipes,
  loadRecipeById,
  recipesDirectory,
} from "./recipeLoader.ts";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..", "..");

test("加载器 import.meta.url 上溯四级；cwd=apps/backend 仍读到虚构配方", () => {
  assert.equal(recipesDirectory(), join(repoRoot, "recipes"));
  const previous = cwd();
  chdir(join(repoRoot, "apps", "backend"));
  try {
    const loaded = loadRecipeById(RECIPE_TXT2IMG);
    assert.equal(loaded.ok, true);
    if (!loaded.ok) {
      return;
    }
    assert.equal(loaded.recipe.id, RECIPE_TXT2IMG);
    assert.equal(loaded.recipe.comfy?.format, "comfy.api");
    assert.ok(loaded.recipe.comfy?.prompt.sampler);
    const installed = loadInstalledRecipes();
    assert.equal(installed.length, 5);
    assert.deepEqual(
      installed.map((item) => item.id).sort(),
      [RECIPE_IMG2IMG, RECIPE_IMG2VIDEO_FIXTURE, RECIPE_IMG2VIDEO_NEEDS_SECRET, RECIPE_REFERENCE, RECIPE_TXT2IMG].sort(),
    );
    const images = installed.filter((item) => item.capability === "image.generate");
    assert.equal(images.every((item) => item.comfy?.prompt !== undefined), true);
    assert.equal(images.every((item) => item.cloud === undefined), true);
    const videos = installed.filter((item) => item.id.startsWith("recipe.video."));
    assert.equal(videos.length, 2);
    assert.equal(videos.every((item) => item.cloud !== undefined && item.comfy === undefined), true);
    const img2img = loadRecipeById(RECIPE_IMG2IMG);
    assert.equal(img2img.ok, true);
    if (img2img.ok) {
      assert.equal(img2img.recipe.profileId, "img2img");
      assert.equal(img2img.recipe.comfy?.prompt.load?.class_type, "FictionalLoadImage");
    }
    const reference = loadRecipeById(RECIPE_REFERENCE);
    assert.equal(reference.ok, true);
    if (reference.ok) {
      assert.equal(reference.recipe.profileId, "reference");
      assert.equal(reference.recipe.comfy?.prompt.ref0?.class_type, "FictionalLoadImage");
      assert.deepEqual(reference.recipe.comfy?.outputNodeIds, ["save"]);
    }
  } finally {
    chdir(previous);
  }
});

test("加载器拒界面格式，句子用 11.1；GET 列表仍是 schema 三张且无 comfy.prompt", () => {
  const ui = parseRecipeFile({ nodes: [], links: [] });
  assert.equal(ui.ok, false);
  if (!ui.ok) {
    assert.equal(ui.code, "RECIPE_UI_FORMAT");
    assert.equal(ui.message, USER_FACING.recipeUiFormat);
  }
  const recipes = listRecipes();
  assert.equal(recipes.length, 5);
  assert.equal(recipes.every((item) => item.enabled), true);
  assert.equal(JSON.stringify(recipes).includes("comfy.prompt"), false);
  assert.equal(JSON.stringify(recipes).includes("example.video.fixture"), false);
  assert.equal(recipes.some((item) => item.id === RECIPE_IMG2IMG), true);
  assert.equal(recipes.some((item) => item.id === RECIPE_REFERENCE), true);
  assert.equal(recipes.some((item) => item.id === RECIPE_IMG2VIDEO_FIXTURE), true);
  const installedOnDisk = loadInstalledRecipes();
  assert.equal(installedOnDisk.length, 5);
  const disk = loadRecipeById(RECIPE_TXT2IMG);
  assert.equal(disk.ok, true);
  if (disk.ok) {
    const summary = toRecipeSummary(disk.recipe);
    assert.equal(JSON.stringify(summary).includes("comfy.prompt"), false);
    assert.equal("comfy" in summary, false);
  }
  assert.equal(LANE_CONFIG.localConcurrency, 1);
  const snapshotTypeLock: RunSnapshot["state"] = "running";
  assert.equal(snapshotTypeLock, "running");
});

test("缺少配方文件则 recipeNotFound，不抛", () => {
  const missing = loadRecipeById("recipe.image.does-not-exist");
  assert.equal(missing.ok, false);
  if (!missing.ok) {
    assert.equal(missing.code, "RECIPE_NOT_FOUND");
    assert.equal(missing.message, USER_FACING.recipeNotFound);
    assert.equal(missing.message, "找不到这张配方。");
  }
});
