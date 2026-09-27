import { requireSecretRef, credentialTargetName } from "./secretRef.ts";
import { copyBytes, type SecretLookup, type SecretStore } from "./types.ts";

/** 测试用。不写文件，不碰 Windows 凭据库。 */
export function createMemorySecretStore(): SecretStore {
  const records = new Map<string, Uint8Array>();

  function keyOf(ref: SecretLookup): string {
    const normalized = requireSecretRef(ref.providerId, ref.account);
    return credentialTargetName(normalized);
  }

  function getSync(ref: SecretLookup): Uint8Array | null {
    return copyBytes(records.get(keyOf(ref)) ?? null);
  }

  function presentSync(ref: SecretLookup): boolean {
    return getSync(ref) !== null;
  }

  return {
    async put(ref, secret) {
      records.set(keyOf(ref), Uint8Array.from(secret));
    },
    async get(ref) {
      return getSync(ref);
    },
    async present(ref) {
      return presentSync(ref);
    },
    async delete(ref) {
      records.delete(keyOf(ref));
    },
    presentSync,
    getSync,
  };
}
