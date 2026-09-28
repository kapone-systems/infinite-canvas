/**
 * 远程 Comfy 的密码或私钥。不走 SecretStore.put，也不改 credentialTargetName。
 * 目标名固定为 CanvasApp:ssh:comfy:account:default。
 * 不超过 2560 字节只进凭据库；更长只写另起名的 DPAPI 文件。两边都不写明文。
 */
import { existsSync, readFileSync, rmSync } from "node:fs";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { join } from "node:path";
import { CRED_MAX_CREDENTIAL_BLOB_SIZE, SecretStoreRejectedError } from "./secretRef.ts";
import { copyBytes, type SecretPlatform } from "./types.ts";

export const SSH_COMFY_CREDENTIAL_TARGET = "CanvasApp:ssh:comfy:account:default";
export const SSH_COMFY_DPAPI_FILENAME = "ssh-comfy.dpapi.bin";

export function sshComfyDpapiPath(dataDir: string): string {
  return join(dataDir, SSH_COMFY_DPAPI_FILENAME);
}

export async function saveSshComfySecret(options: {
  dataDir: string;
  platform: SecretPlatform;
  restrictFile: (filePath: string) => Promise<void>;
  secret: Uint8Array;
}): Promise<void> {
  const target = SSH_COMFY_CREDENTIAL_TARGET;
  const path = sshComfyDpapiPath(options.dataDir);
  if (options.secret.byteLength <= CRED_MAX_CREDENTIAL_BLOB_SIZE) {
    await rm(path, { force: true });
    await rm(`${path}.partial`, { force: true });
    try {
      options.platform.credWrite(target, options.secret);
    } catch {
      try {
        options.platform.credDelete(target);
      } catch {
        // 未完成的凭据条目也要清掉。
      }
      throw new SecretStoreRejectedError();
    }
    return;
  }
  try {
    options.platform.credDelete(target);
  } catch {
    throw new SecretStoreRejectedError();
  }
  let cipher: Uint8Array;
  try {
    cipher = options.platform.protectData(options.secret);
  } catch {
    await rm(path, { force: true });
    throw new SecretStoreRejectedError();
  }
  const partial = `${path}.partial`;
  let renamed = false;
  try {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(partial, cipher, { mode: 0o600 });
    await options.restrictFile(partial);
    await rm(path, { force: true });
    await rename(partial, path);
    renamed = true;
    await options.restrictFile(path);
  } catch {
    await rm(partial, { force: true });
    if (renamed) {
      await rm(path, { force: true });
    }
    throw new SecretStoreRejectedError();
  }
}

export function readSshComfySecretSync(dataDir: string, platform: SecretPlatform): Uint8Array | null {
  const path = sshComfyDpapiPath(dataDir);
  if (existsSync(path)) {
    try {
      const cipher = new Uint8Array(readFileSync(path));
      return copyBytes(platform.unprotectData(cipher));
    } catch {
      return null;
    }
  }
  try {
    return copyBytes(platform.credRead(SSH_COMFY_CREDENTIAL_TARGET));
  } catch {
    return null;
  }
}

export function deleteSshComfySecretSync(dataDir: string, platform: SecretPlatform): void {
  const path = sshComfyDpapiPath(dataDir);
  let failed = false;
  try {
    platform.credDelete(SSH_COMFY_CREDENTIAL_TARGET);
  } catch {
    failed = true;
  }
  try {
    rmSync(path, { force: true });
    rmSync(`${path}.partial`, { force: true });
  } catch {
    failed = true;
  }
  if (failed) {
    throw new SecretStoreRejectedError();
  }
}
