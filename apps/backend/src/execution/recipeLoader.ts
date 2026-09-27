/**
 * 方案第 9.5 节配方加载器。
 * 路径钉死：dirname(import.meta.url) 上溯四级到仓库根 /recipes。
 * cwd 为 apps/backend 时仍能找到文件。拒绝界面格式的句子来自 USER_FACING。
 * GET /recipes 不得改成这个加载器；列表仍走 schema listRecipes。
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  parseRecipeFile,
  USER_FACING,
  type ParseRecipeResult,
  type RecipeFile,
} from "@canvas/schema";

export type LoadRecipeResult =
  | { ok: true; recipe: RecipeFile }
  | {
      ok: false;
      code: "RECIPE_UI_FORMAT" | "RECIPE_BARE_PROMPT" | "RECIPE_INVALID" | "RECIPE_NOT_FOUND";
      message: string;
    };

export function recipesDirectory(fromMetaUrl: string = import.meta.url): string {
  const here = dirname(fileURLToPath(fromMetaUrl));
  return join(here, "..", "..", "..", "..", "recipes");
}

export function loadRecipeById(id: string, fromMetaUrl: string = import.meta.url): LoadRecipeResult {
  const filePath = join(recipesDirectory(fromMetaUrl), `${id}.json`);
  if (!existsSync(filePath)) {
    return { ok: false, code: "RECIPE_NOT_FOUND", message: USER_FACING.recipeNotFound };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(filePath, "utf8")) as unknown;
  } catch {
    return { ok: false, code: "RECIPE_INVALID", message: USER_FACING.recipeNotFound };
  }
  const parsed: ParseRecipeResult = parseRecipeFile(raw);
  if (!parsed.ok) {
    return parsed;
  }
  return { ok: true, recipe: parsed.recipe };
}

export function loadInstalledRecipes(fromMetaUrl: string = import.meta.url): RecipeFile[] {
  const dir = recipesDirectory(fromMetaUrl);
  if (!existsSync(dir)) {
    return [];
  }
  const names = readdirSync(dir).filter((name) => name.endsWith(".json")).sort();
  const recipes: RecipeFile[] = [];
  for (const name of names) {
    const raw = JSON.parse(readFileSync(join(dir, name), "utf8")) as unknown;
    const parsed = parseRecipeFile(raw);
    if (!parsed.ok) {
      throw new Error(parsed.message);
    }
    recipes.push(parsed.recipe);
  }
  return recipes;
}
