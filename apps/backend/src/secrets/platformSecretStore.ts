import { existsSync, readFileSync, rmSync } from "node:fs";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
  CRED_MAX_CREDENTIAL_BLOB_SIZE,
  SecretStoreRejectedError,
  cipherFilePath,
  credentialTargetName,
  requireSecretRef,
} from "./secretRef.ts";
import { copyBytes, type SecretLookup, type SecretPlatform, type SecretStore } from "./types.ts";

/**
 * 短于或等于 2560 字节只在凭据库；更长只在 DPAPI 文件。
 * 换成另一种长度时先删掉另一种。delete 两处都删。
 * 失败时删掉未完成的密文，不改成明文文件。
 */
export function createPlatformSecretStore(options: {
  platform: SecretPlatform;
  secretsDir: string;
  restrictFile: (filePath: string) => Promise<void>;
}): SecretStore {
  const { platform, secretsDir, restrictFile } = options;

  function normalized(ref: SecretLookup) {
    return requireSecretRef(ref.providerId, ref.account);
  }

  function readCipher(ref: SecretLookup): Uint8Array | null {
    const path = cipherFilePath(secretsDir, normalized(ref));
    if (!existsSync(path)) {
      return null;
    }
    return new Uint8Array(readFileSync(path));
  }

  function deleteCipherSync(ref: SecretLookup): void {
    const path = cipherFilePath(secretsDir, normalized(ref));
    rmSync(path, { force: true });
    rmSync(`${path}.partial`, { force: true });
  }

  function getSync(ref: SecretLookup): Uint8Array | null {
    const current = normalized(ref);
    const file = readCipher(current);
    if (file !== null) {
      try {
        return copyBytes(platform.unprotectData(file));
      } catch {
        return null;
      }
    }
    return copyBytes(platform.credRead(credentialTargetName(current)));
  }

  function presentSync(ref: SecretLookup): boolean {
    return getSync(ref) !== null;
  }

  async function put(ref: SecretLookup, secret: Uint8Array): Promise<void> {
    const current = normalized(ref);
    const target = credentialTargetName(current);
    const path = cipherFilePath(secretsDir, current);
    if (secret.byteLength <= CRED_MAX_CREDENTIAL_BLOB_SIZE) {
      deleteCipherSync(current);
      try {
        platform.credWrite(target, secret);
      } catch {
        try {
          platform.credDelete(target);
        } catch {
          // 未完成的凭据条目也要清掉。
        }
        throw new SecretStoreRejectedError();
      }
      return;
    }
    try {
      platform.credDelete(target);
    } catch {
      throw new SecretStoreRejectedError();
    }
    let cipher: Uint8Array;
    try {
      cipher = platform.protectData(secret);
    } catch {
      deleteCipherSync(current);
      throw new SecretStoreRejectedError();
    }
    const partial = `${path}.partial`;
    let renamed = false;
    try {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(partial, cipher, { mode: 0o600 });
      await restrictFile(partial);
      await rm(path, { force: true });
      await rename(partial, path);
      renamed = true;
      await restrictFile(path);
    } catch {
      await rm(partial, { force: true });
      if (renamed) {
        await rm(path, { force: true });
      }
      throw new SecretStoreRejectedError();
    }
  }

  async function remove(ref: SecretLookup): Promise<void> {
    const current = normalized(ref);
    const target = credentialTargetName(current);
    let failed = false;
    try {
      platform.credDelete(target);
    } catch {
      failed = true;
    }
    try {
      deleteCipherSync(current);
    } catch {
      failed = true;
    }
    if (failed) {
      throw new SecretStoreRejectedError();
    }
  }

  return {
    put,
    async get(ref) {
      return getSync(ref);
    },
    async present(ref) {
      return presentSync(ref);
    },
    delete: remove,
    presentSync,
    getSync,
  };
}
