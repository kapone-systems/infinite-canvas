const INVALID_CHARS = /[<>:"/\\|?*\u0000-\u001f]/;
const RESERVED_STEM = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i;

/**
 * Windows 文件名规则：工程文件夹名用这一套过滤。
 */
export function isValidWindowsFolderName(name: string): boolean {
  if (name.length === 0 || name.length > 255) {
    return false;
  }
  if (name !== name.trim()) {
    return false;
  }
  if (name === "." || name === "..") {
    return false;
  }
  if (INVALID_CHARS.test(name)) {
    return false;
  }
  if (name.endsWith(".") || name.endsWith(" ")) {
    return false;
  }
  const stem = name.includes(".") ? name.slice(0, name.indexOf(".")) : name;
  if (RESERVED_STEM.test(stem)) {
    return false;
  }
  return true;
}
