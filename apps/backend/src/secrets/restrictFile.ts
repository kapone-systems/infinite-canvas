/**
 * 路径走标准输入，不进 argv。不授予 Everyone。
 * 密钥字节不进这个进程。
 */
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { powershellExe } from "./windowsPlatform.ts";

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "restrict.ps1");

export function restrictSecretFile(filePath: string): Promise<void> {
  const result = spawnSync(powershellExe(), [
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    SCRIPT,
  ], {
    input: Buffer.from(`${filePath}\n`, "utf8"),
    windowsHide: true,
    timeout: 15_000,
  });
  if (result.error !== undefined || result.status !== 0) {
    return Promise.reject(new Error("SECRET_ACL"));
  }
  return Promise.resolve();
}
