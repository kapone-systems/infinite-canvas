/**
 * Node 侧：把夹具媒体拷进当前已打开工程的 media/，票据才能签 derived / blobs。
 * 不要从浏览器生产入口 import 本文件（依赖 node:fs）。
 */
/// <reference types="node" />
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  FIXTURE_WEBP_SHA256,
  fixtureBlobRelPath,
  fixtureMediaFiles,
  fixtureThumbRelPath,
} from "./media.ts";

export type FixtureMediaInstall = {
  contentHash: string;
  blobRelPath: string;
  thumbRelPath: string;
};

function absoluteFromProjectRel(projectRoot: string, relativePath: string): string {
  return join(projectRoot, ...relativePath.split("/"));
}

export async function copyFixtureMediaIntoProject(
  projectRoot: string,
): Promise<FixtureMediaInstall> {
  for (const file of fixtureMediaFiles()) {
    const abs = absoluteFromProjectRel(projectRoot, file.relativePath);
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, file.bytes);
  }
  return {
    contentHash: FIXTURE_WEBP_SHA256,
    blobRelPath: fixtureBlobRelPath(),
    thumbRelPath: fixtureThumbRelPath(),
  };
}
