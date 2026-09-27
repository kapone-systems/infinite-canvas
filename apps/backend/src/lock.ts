import {
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { LOCK_RELATIVE_PATH } from "./appData.ts";
import { BACKEND_MESSAGES } from "./messages.ts";

export type LockHandle = {
  path: string;
  release: () => void;
};

export type AcquireLockResult =
  | { ok: true; lock: LockHandle }
  | { ok: false; message: string };

function isErrno(err: unknown, code: string): boolean {
  return typeof err === "object" && err !== null && "code" in err && (err as { code: unknown }).code === code;
}

export function isPidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    if (isErrno(err, "EPERM")) {
      return true;
    }
    return false;
  }
}

function readLockPid(lockPath: string): number | null {
  try {
    const text = readFileSync(lockPath, "utf8").trim();
    const pid = Number.parseInt(text, 10);
    if (!Number.isInteger(pid) || pid <= 0) {
      return null;
    }
    return pid;
  } catch {
    return null;
  }
}

function tryRemoveStaleLock(lockPath: string): boolean {
  const pid = readLockPid(lockPath);
  if (pid !== null && isPidAlive(pid)) {
    return false;
  }
  try {
    unlinkSync(lockPath);
    return true;
  } catch {
    return false;
  }
}

function openExclusive(lockPath: string): number | "exists" {
  try {
    return openSync(lockPath, "wx");
  } catch (err) {
    if (isErrno(err, "EEXIST")) {
      return "exists";
    }
    throw err;
  }
}

/**
 * 应用数据目录单实例锁。第二进程拿不到锁则失败，不得杀掉第一进程。
 */
export function acquireBackendLock(dataDir: string): AcquireLockResult {
  const lockPath = join(dataDir, LOCK_RELATIVE_PATH);
  mkdirSync(dirname(lockPath), { recursive: true });

  let fd = openExclusive(lockPath);
  if (fd === "exists") {
    if (tryRemoveStaleLock(lockPath)) {
      fd = openExclusive(lockPath);
    }
  }
  if (fd === "exists") {
    return { ok: false, message: BACKEND_MESSAGES.lockHeld };
  }

  try {
    writeSync(fd, `${process.pid}\n`);
  } catch (err) {
    try {
      closeSync(fd);
    } catch {
      /* ignore */
    }
    try {
      unlinkSync(lockPath);
    } catch {
      /* ignore */
    }
    throw err;
  }

  let released = false;
  const release = (): void => {
    if (released) {
      return;
    }
    released = true;
    try {
      closeSync(fd);
    } catch {
      /* ignore */
    }
    try {
      unlinkSync(lockPath);
    } catch {
      /* ignore */
    }
  };

  return { ok: true, lock: { path: lockPath, release } };
}
