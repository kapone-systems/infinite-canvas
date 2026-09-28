/**
 * 「使用本机 ComfyUI」不进 app.json。
 * 旧安装包和源码共用应用数据目录，writeAppJson 会整份写回已知字段，
 * 开关若写进 app.json，保存地址时会被抹掉。
 */
import { readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

export const USE_LOCAL_COMFY_FILENAME = "use-local-comfy.json";

export function useLocalComfyPath(dataDir: string): string {
  return join(dataDir, USE_LOCAL_COMFY_FILENAME);
}

/** 缺文件、坏 JSON、或 enabled 不是 true，都当关。 */
export function readUseLocalComfySync(dataDir: string): boolean {
  try {
    const raw = JSON.parse(readFileSync(useLocalComfyPath(dataDir), "utf8")) as unknown;
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
      return false;
    }
    return (raw as { enabled?: unknown }).enabled === true;
  } catch {
    return false;
  }
}

export async function writeUseLocalComfy(dataDir: string, enabled: boolean): Promise<void> {
  await mkdir(dataDir, { recursive: true });
  const body = `${JSON.stringify({ enabled }, null, 2)}\n`;
  await writeFile(useLocalComfyPath(dataDir), body, "utf8");
}

/** 只认命令行 --fake-executor。有它就继续用替身，即使用户打开了开关。 */
export function argvRequestsFakeExecutor(argv: readonly string[]): boolean {
  return argv.some((arg) => arg === "--fake-executor" || arg.startsWith("--fake-executor="));
}

export function shouldUseRealComfy(input: { enabled: boolean; fakeExecutorFlag: boolean }): boolean {
  return input.enabled && !input.fakeExecutorFlag;
}
