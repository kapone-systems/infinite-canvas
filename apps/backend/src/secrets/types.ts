export type SecretLookup = {
  providerId: string;
  account?: string;
};

/**
 * 四种方法认同一份记录。presentSync / getSync 与异步方法走同一实现，
 * 供仍是同步的预检在 requiresSecret 分支里调用。
 */
export type SecretStore = {
  put(ref: SecretLookup, secret: Uint8Array): Promise<void>;
  get(ref: SecretLookup): Promise<Uint8Array | null>;
  present(ref: SecretLookup): Promise<boolean>;
  delete(ref: SecretLookup): Promise<void>;
  presentSync(ref: SecretLookup): boolean;
  getSync(ref: SecretLookup): Uint8Array | null;
};

export type SecretPlatform = {
  credWrite(targetName: string, blob: Uint8Array): void;
  credRead(targetName: string): Uint8Array | null;
  credDelete(targetName: string): void;
  protectData(plain: Uint8Array): Uint8Array;
  unprotectData(cipher: Uint8Array): Uint8Array;
};

export function copyBytes(bytes: Uint8Array | null): Uint8Array | null {
  if (bytes === null) {
    return null;
  }
  return Uint8Array.from(bytes);
}
