import { MEDIA_REF_PATH_KEYS, type ProjectRelPath } from "./types.ts";

const DRIVE_LETTER = /^[A-Za-z]:/;

/** 方案第 9.1 / 5.2 节：正斜杠、不以 / 开头、不含盘符、不含 ..、不含反斜杠。 */
export function isValidProjectRelPath(value: string): boolean {
  if (value.length === 0) {
    return false;
  }
  if (value.includes("\\") || value.includes("\0")) {
    return false;
  }
  if (value.startsWith("/")) {
    return false;
  }
  if (DRIVE_LETTER.test(value)) {
    return false;
  }
  if (value.includes("://")) {
    return false;
  }
  const segments = value.split("/");
  for (const segment of segments) {
    if (segment === "" || segment === "." || segment === "..") {
      return false;
    }
  }
  return true;
}

export function asProjectRelPath(value: string): ProjectRelPath | null {
  return isValidProjectRelPath(value) ? value : null;
}

/** 方案第 9.3 节。 */
export function blobRelPath(sha256: string): ProjectRelPath {
  return `media/blobs/${sha256.slice(0, 2)}/${sha256}.blob`;
}

const PATH_KEY_SET = new Set<string>(MEDIA_REF_PATH_KEYS);

export function isMediaRefPathKey(key: string): boolean {
  return PATH_KEY_SET.has(key);
}

/** 递归找出第一个非法工程相对路径（空字符串也算非法）。 */
export function findInvalidProjectRelPath(value: unknown): string | null {
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
      if (isMediaRefPathKey(key)) {
        if (child === null) {
          continue;
        }
        if (typeof child !== "string" || !isValidProjectRelPath(child)) {
          return typeof child === "string" ? child : key;
        }
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
