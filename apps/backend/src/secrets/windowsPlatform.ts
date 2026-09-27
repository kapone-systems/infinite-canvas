/**
 * 只在生产进程里调用。测试注入假的 SecretPlatform，不要跑这个文件的 spawn。
 * 密钥字节只走标准输入，不进 argv，不进环境变量。
 */
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { SecretPlatform } from "./types.ts";

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "wincred.ps1");

export function windowsPlatformArgs(scriptPath: string = SCRIPT): string[] {
  return ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", scriptPath];
}

export function powershellExe(): string {
  const root = process.env.SystemRoot ?? "C:\\Windows";
  return join(root, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
}

export function frameSecretCall(op: number, name: string, data: Uint8Array): Buffer {
  const nameBuf = Buffer.from(name, "utf8");
  const payload = Buffer.alloc(1 + 4 + nameBuf.length + 4 + data.byteLength);
  payload[0] = op;
  payload.writeUInt32LE(nameBuf.length, 1);
  nameBuf.copy(payload, 5);
  const at = 5 + nameBuf.length;
  payload.writeUInt32LE(data.byteLength, at);
  Buffer.from(data).copy(payload, at + 4);
  return payload;
}

function parseFrame(out: Buffer): { status: number; bytes: Uint8Array } {
  if (out.length < 5) {
    throw new Error("SECRET_PLATFORM");
  }
  const status = out[0] ?? 2;
  const len = out.readUInt32LE(1);
  if (out.length < 5 + len) {
    throw new Error("SECRET_PLATFORM");
  }
  return { status, bytes: new Uint8Array(out.subarray(5, 5 + len)) };
}

function callPlatform(op: number, name: string, data: Uint8Array): { status: number; bytes: Uint8Array } {
  const payload = frameSecretCall(op, name, data);
  const result = spawnSync(powershellExe(), windowsPlatformArgs(), {
    input: payload,
    windowsHide: true,
    timeout: 20_000,
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error !== undefined || result.status !== 0 || result.stdout == null) {
    throw new Error("SECRET_PLATFORM");
  }
  const stdout = Buffer.isBuffer(result.stdout) ? result.stdout : Buffer.from(result.stdout);
  const frame = parseFrame(stdout);
  if (frame.status === 2) {
    throw new Error("SECRET_PLATFORM");
  }
  return frame;
}

export function createWindowsSecretPlatform(): SecretPlatform {
  return {
    credWrite(targetName, blob) {
      callPlatform(1, targetName, blob);
    },
    credRead(targetName) {
      const frame = callPlatform(2, targetName, new Uint8Array());
      if (frame.status === 1) {
        return null;
      }
      return frame.bytes;
    },
    credDelete(targetName) {
      callPlatform(3, targetName, new Uint8Array());
    },
    protectData(plain) {
      return callPlatform(4, "", plain).bytes;
    },
    unprotectData(cipher) {
      return callPlatform(5, "", cipher).bytes;
    },
  };
}
