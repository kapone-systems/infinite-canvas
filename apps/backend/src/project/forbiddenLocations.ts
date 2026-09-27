import { homedir } from "node:os";
import { isAbsolute, join, relative, resolve, parse as parsePath } from "node:path";

export type ForbiddenLocationContext = {
  home: string;
  appData: string;
};

export function defaultForbiddenContext(appData: string, home = homedir()): ForbiddenLocationContext {
  return { home, appData };
}

function normalizeFsPath(value: string): string {
  const resolved = resolve(value);
  if (process.platform === "win32") {
    return resolved.replace(/[/\\]+$/, "").toLowerCase();
  }
  if (resolved !== "/" && resolved.endsWith("/")) {
    return resolved.replace(/\/+$/, "");
  }
  return resolved;
}

export function pathsEqual(a: string, b: string): boolean {
  return normalizeFsPath(a) === normalizeFsPath(b);
}

export function isDiskRoot(absolutePath: string): boolean {
  const resolved = resolve(absolutePath);
  const root = parsePath(resolved).root;
  if (root.length === 0) {
    return false;
  }
  return pathsEqual(resolved, root);
}

function isInsideOrSame(parent: string, child: string): boolean {
  if (pathsEqual(parent, child)) {
    return true;
  }
  const rel = relative(resolve(parent), resolve(child));
  if (rel.length === 0) {
    return true;
  }
  if (rel.startsWith("..")) {
    return false;
  }
  if (isAbsolute(rel)) {
    return false;
  }
  return true;
}

/**
 * 拒绝把磁盘根、用户主目录、应用数据目录当工程文件夹。
 * 应用数据目录的子路径一并拒绝，避免工程写进 locks / 任务库旁边。
 */
export function isForbiddenProjectFolder(
  absolutePath: string,
  ctx: ForbiddenLocationContext,
): boolean {
  const resolved = resolve(absolutePath);
  if (isDiskRoot(resolved)) {
    return true;
  }
  if (pathsEqual(resolved, ctx.home)) {
    return true;
  }
  if (isInsideOrSame(ctx.appData, resolved)) {
    return true;
  }
  return false;
}

export function projectDirFromParent(parentDir: string, name: string): string {
  return resolve(join(parentDir, name));
}
