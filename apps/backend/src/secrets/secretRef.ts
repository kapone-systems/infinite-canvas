/**
 * 方案第 9.7 节。目标名在写入前小写。整段「.」或「..」拒绝，不进路径。
 */
import { USER_FACING } from "@canvas/schema";
import { isAbsolute, relative, resolve } from "node:path";

export const SECRET_ID_PATTERN = /^[a-z0-9._-]{1,64}$/;
export const CRED_TYPE_GENERIC = 1;
export const CRED_MAX_CREDENTIAL_BLOB_SIZE = 2560;
export const DEFAULT_SECRET_ACCOUNT = "default";

export type SecretRef = {
  providerId: string;
  account: string;
};

export class SecretRefInvalidError extends Error {
  readonly code = "SECRET_REF_INVALID" as const;

  constructor() {
    super("SECRET_REF_INVALID");
    this.name = "SecretRefInvalidError";
  }
}

export class SecretStoreRejectedError extends Error {
  readonly code = "SECRET_STORE_REJECTED" as const;

  constructor() {
    super(USER_FACING.secretStoreRejected);
    this.name = "SecretStoreRejectedError";
  }
}

export function normalizeSecretRef(providerId: string, account?: string): SecretRef | null {
  const id = providerId.toLowerCase();
  const rawAccount = account === undefined || account.length === 0 ? DEFAULT_SECRET_ACCOUNT : account;
  const acc = rawAccount.toLowerCase();
  if (!SECRET_ID_PATTERN.test(id) || !SECRET_ID_PATTERN.test(acc)) {
    return null;
  }
  if (id === "." || id === ".." || acc === "." || acc === "..") {
    return null;
  }
  return { providerId: id, account: acc };
}

export function requireSecretRef(providerId: string, account?: string): SecretRef {
  const ref = normalizeSecretRef(providerId, account);
  if (ref === null) {
    throw new SecretRefInvalidError();
  }
  return ref;
}

export function credentialTargetName(ref: SecretRef): string {
  return `CanvasApp:provider:${ref.providerId}:account:${ref.account}`;
}

/** 成品路径必须落在 secrets 目录里。调用前 ref 已经拒绝「.」和「..」。 */
export function cipherFilePath(secretsDir: string, ref: SecretRef): string {
  const root = resolve(secretsDir);
  const name = `${ref.providerId}__${ref.account}.bin`;
  if (name.includes("/") || name.includes("\\") || name.includes("\0") || name === "." || name === "..") {
    throw new SecretRefInvalidError();
  }
  const full = resolve(root, name);
  const rel = relative(root, full);
  if (rel.length === 0 || rel.startsWith("..") || isAbsolute(rel)) {
    throw new SecretRefInvalidError();
  }
  return full;
}
