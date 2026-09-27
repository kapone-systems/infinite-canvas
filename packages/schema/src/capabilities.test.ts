import assert from "node:assert/strict";
import { test } from "node:test";
import {
  addableRoles,
  capabilityByProfileId,
  defaultParamsFromRecipe,
  enabledRecipeForProfile,
  listCapabilities,
  listRecipes,
  RECIPE_IMG2IMG,
  RECIPE_IMG2VIDEO_FIXTURE,
  RECIPE_IMG2VIDEO_NEEDS_SECRET,
  RECIPE_REFERENCE,
  RECIPE_TXT2IMG,
  roleDisplayIndex,
  roleLabel,
  slotsFromDescriptor,
  slotTitle,
} from "./capabilities.ts";
import { RANDOM_SEED } from "./types.ts";
import { USER_FACING } from "./userFacingMessages.ts";

test("listRecipes 图片三张在前，图生视频夹具排在缺密钥桩前面", () => {
  const ids = listRecipes().map((item) => item.id);
  assert.deepEqual(ids, [
    RECIPE_TXT2IMG,
    RECIPE_IMG2IMG,
    RECIPE_REFERENCE,
    RECIPE_IMG2VIDEO_FIXTURE,
    RECIPE_IMG2VIDEO_NEEDS_SECRET,
  ]);
  assert.equal(RECIPE_TXT2IMG, "recipe.image.txt2img.fictional");
  assert.equal(RECIPE_IMG2IMG, "recipe.image.img2img.fictional");
  assert.equal(RECIPE_REFERENCE, "recipe.image.reference.fictional");
  for (const recipe of listRecipes()) {
    assert.equal(recipe.enabled, true);
    assert.equal(recipe.implemented, true);
    if (recipe.profileId === "img2video") {
      continue;
    }
    assert.equal(recipe.params.find((p) => p.key === "seed")?.default, RANDOM_SEED);
  }
  const fixture = enabledRecipeForProfile("img2video");
  assert.equal(fixture?.id, RECIPE_IMG2VIDEO_FIXTURE);
  assert.notEqual(fixture?.id, "example.video.fixture");
  const params = defaultParamsFromRecipe(fixture!);
  assert.equal(params.durationSeconds, "4");
  assert.equal(typeof params.durationSeconds, "string");
});

test("slotsFromDescriptor 三套默认槽数", () => {
  let n = 0;
  const ids = () => `s${++n}`;
  const txt = slotsFromDescriptor(capabilityByProfileId("txt2img")!, ids);
  assert.equal(txt.length, 1);
  assert.equal(txt[0]?.role, "prompt");
  assert.equal(txt[0]?.order, 0);

  n = 0;
  const img = slotsFromDescriptor(capabilityByProfileId("img2img")!, ids);
  assert.equal(img.length, 2);
  assert.deepEqual(img.map((s) => s.role), ["prompt", "source_image"]);
  assert.equal(img.some((s) => s.role === "mask"), false);

  n = 0;
  const ref = slotsFromDescriptor(capabilityByProfileId("reference")!, ids);
  assert.deepEqual(ref.map((s) => s.role), ["prompt", "reference_image"]);
  assert.equal(ref.filter((s) => s.role === "style_reference").length, 0);
  assert.equal(ref.filter((s) => s.role === "character_reference").length, 0);
  assert.equal(ref.filter((s) => s.role === "reference_image").length, 1);
});

test("addableRoles 不含已满 prompt；参考图还可加", () => {
  let n = 0;
  const txtCap = capabilityByProfileId("txt2img")!;
  const txtSlots = slotsFromDescriptor(txtCap, () => `t${++n}`);
  assert.deepEqual(addableRoles(txtCap, txtSlots), []);

  n = 0;
  const imgCap = capabilityByProfileId("img2img")!;
  const imgSlots = slotsFromDescriptor(imgCap, () => `i${++n}`);
  assert.deepEqual(addableRoles(imgCap, imgSlots), ["mask"]);
  assert.equal(addableRoles(imgCap, imgSlots).includes("prompt"), false);

  n = 0;
  const refCap = capabilityByProfileId("reference")!;
  const refSlots = slotsFromDescriptor(refCap, () => `r${++n}`);
  assert.deepEqual(addableRoles(refCap, refSlots), [
    "reference_image",
    "style_reference",
    "character_reference",
  ]);
});

test("roleLabel 用 5.4 中文名，同角色从 1 起", () => {
  assert.equal(roleLabel("prompt"), "提示词");
  assert.equal(roleLabel("source_image"), "原图");
  assert.equal(roleLabel("reference_image"), "参考图");
  assert.equal(roleLabel("style_reference"), "风格参考");
  assert.equal(roleLabel("character_reference"), "角色参考");
  assert.equal(roleLabel("mask"), "遮罩");
  assert.equal(roleLabel("first_frame"), "首帧");
  assert.equal(roleLabel("last_frame"), "尾帧");
  assert.equal(roleLabel("audio_reference"), "音频参考");
  const slots = [
    { id: "a", role: "reference_image" as const, order: 0, edgeId: null },
    { id: "b", role: "reference_image" as const, order: 1, edgeId: null },
  ];
  assert.equal(roleDisplayIndex(slots, slots[0]!), 1);
  assert.equal(roleDisplayIndex(slots, slots[1]!), 2);
  assert.equal(slotTitle(slots, slots[0]!), "参考图 1");
  assert.equal(slotTitle(slots, slots[1]!), "参考图 2");
});

test("未实现放以后再做：complete / txt2video / talking-head；图生视频已接入且默认夹具", () => {
  const unimplemented = listCapabilities().filter((item) => !item.implemented);
  const profiles = unimplemented.map((item) => item.profileId);
  assert.deepEqual(profiles, ["complete", "txt2video", "talking-head"]);
  assert.equal(USER_FACING.notImplemented, "这一类还没接入。");
  assert.equal(enabledRecipeForProfile("complete"), null);
  assert.equal(enabledRecipeForProfile("txt2video"), null);
  assert.equal(enabledRecipeForProfile("talking-head"), null);
  assert.equal(enabledRecipeForProfile("txt2img")?.id, RECIPE_TXT2IMG);
  assert.equal(defaultParamsFromRecipe(enabledRecipeForProfile("txt2img")!).seed, RANDOM_SEED);
  assert.equal(capabilityByProfileId("img2video")?.implemented, true);
  assert.equal(enabledRecipeForProfile("img2video")?.id, RECIPE_IMG2VIDEO_FIXTURE);
});

test("可运行节点不提供 audio_reference 槽；这一类还没接入。仍在", () => {
  const runnable = listCapabilities().filter((item) => item.implemented);
  assert.ok(runnable.length > 0);
  for (const cap of runnable) {
    assert.equal(
      cap.slots.some((slot) => slot.role === "audio_reference"),
      false,
      cap.profileId,
    );
  }
  for (const recipe of listRecipes()) {
    if (!recipe.implemented) {
      continue;
    }
    assert.equal(
      recipe.slots.some((slot) => slot.role === "audio_reference"),
      false,
      recipe.id,
    );
  }
  const lipsync = listCapabilities().find((item) => item.profileId === "talking-head");
  assert.equal(lipsync?.implemented, false);
  assert.equal(lipsync?.slots.some((slot) => slot.role === "audio_reference"), false);
  const txt2video = listCapabilities().find((item) => item.profileId === "txt2video");
  assert.equal(txt2video?.implemented, false);
  assert.equal(txt2video?.kind, "video.generate");
  assert.equal(txt2video?.slots.some((slot) => slot.role === "audio_reference"), false);
  assert.equal(USER_FACING.notImplemented, "这一类还没接入。");
});
