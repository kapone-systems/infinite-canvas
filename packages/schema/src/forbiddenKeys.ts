/**
 * 方案第 9.1 节：保存时递归检查完整键名（忽略大小写）与 data: 二进制前缀。
 */

export const FORBIDDEN_KEYS = [
  "apiKey",
  "api_key",
  "apikey",
  "authorization",
  "secret",
  "secretKey",
  "secret_key",
  "accessToken",
  "refreshToken",
  "token",
  "password",
  "bearer",
] as const;

export const FORBIDDEN_DATA_URI_PREFIXES = [
  "data:image/",
  "data:video/",
  "data:audio/",
  "data:application/",
] as const;

const FORBIDDEN_KEY_NORMALIZED = new Set(
  FORBIDDEN_KEYS.map((key) => key.toLowerCase()),
);

export function isForbiddenKey(key: string): boolean {
  return FORBIDDEN_KEY_NORMALIZED.has(key.toLowerCase());
}

export function matchingDataUriPrefix(value: string): string | null {
  const lower = value.toLowerCase();
  for (const prefix of FORBIDDEN_DATA_URI_PREFIXES) {
    if (lower.startsWith(prefix)) {
      return prefix;
    }
  }
  return null;
}

export function findForbiddenKey(value: unknown): string | null {
  const seen = new Set<object>();
  const visit = (node: unknown): string | null => {
    if (node === null || typeof node !== "object") {
      return null;
    }
    if (seen.has(node)) {
      return null;
    }
    seen.add(node);
    if (Array.isArray(node)) {
      for (const item of node) {
        const found = visit(item);
        if (found !== null) {
          return found;
        }
      }
      return null;
    }
    for (const [key, child] of Object.entries(node)) {
      if (isForbiddenKey(key)) {
        return key;
      }
      const found = visit(child);
      if (found !== null) {
        return found;
      }
    }
    return null;
  };
  return visit(value);
}

export function findForbiddenDataUri(value: unknown): string | null {
  const seen = new Set<object>();
  const visit = (node: unknown): string | null => {
    if (typeof node === "string") {
      return matchingDataUriPrefix(node);
    }
    if (node === null || typeof node !== "object") {
      return null;
    }
    if (seen.has(node)) {
      return null;
    }
    seen.add(node);
    if (Array.isArray(node)) {
      for (const item of node) {
        const found = visit(item);
        if (found !== null) {
          return found;
        }
      }
      return null;
    }
    for (const child of Object.values(node)) {
      const found = visit(child);
      if (found !== null) {
        return found;
      }
    }
    return null;
  };
  return visit(value);
}
