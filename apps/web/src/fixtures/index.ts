/**
 * 开发夹具 API。仅开发构建使用。
 * 生产入口（main.tsx / App.tsx）不得静态、无条件 import 本目录的加载按钮。
 * 拷贝媒体到工程目录请用 copyMedia.ts（Node / 测试），不要打进生产包。
 */
export {
  DEFAULT_FIXTURE_SEED,
  FAR_COUNTS,
  FAR_ZOOM,
  FIXTURE_NOW_ISO,
  LOAD_THOUSAND_LABEL,
  applyFixtureToStore,
  createCopyInternalEdgesFixture,
  createFixtureLoaders,
  createOverlapFixture,
  edgesWithBothEndsIn,
  farNodeId,
  farNodeKind,
  farNodePosition,
  generateFarFixture,
  generateHundredFixture,
  generateThousandFarFixture,
  generateTwentyFixture,
  injectFakeVariants,
  slotWorldPoint,
} from "./generate.ts";
export type {
  CopyInternalEdgesFixture,
  FarCount,
  OverlapFixture,
} from "./generate.ts";
export {
  FIXTURE_WEBP_BASE64,
  FIXTURE_WEBP_BYTES,
  FIXTURE_WEBP_SHA256,
  THUMB_WEBP_LONGEDGE_512_V1,
  derivedRelPath,
  fixtureBlobRelPath,
  fixtureImageMediaRef,
  fixtureMediaFiles,
  fixtureThumbRelPath,
} from "./media.ts";
export type { FixtureMediaFile } from "./media.ts";
