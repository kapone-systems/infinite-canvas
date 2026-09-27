export type TokenLocation = {
  hash: string;
  search: string;
};

/**
 * 会话令牌只从 URL 片段 `#token=` 读取。
 * 查询串 `?token=` 一律忽略，也不得把令牌写回查询串。
 */
export function readSessionToken(location: TokenLocation): string | null {
  const raw = location.hash.startsWith("#") ? location.hash.slice(1) : location.hash;
  if (raw.length === 0) {
    return null;
  }
  const params = new URLSearchParams(raw);
  const token = params.get("token");
  if (token === null) {
    return null;
  }
  const trimmed = token.trim();
  return trimmed.length === 0 ? null : trimmed;
}

export function readSessionTokenFromWindow(): string | null {
  return readSessionToken(window.location);
}
