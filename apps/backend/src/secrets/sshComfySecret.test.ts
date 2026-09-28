/**
 * 不调用真实 CredWrite。平台是测试里的假对象。
 */
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { CRED_MAX_CREDENTIAL_BLOB_SIZE } from "./secretRef.ts";
import {
  SSH_COMFY_CREDENTIAL_TARGET,
  SSH_COMFY_DPAPI_FILENAME,
  deleteSshComfySecretSync,
  readSshComfySecretSync,
  saveSshComfySecret,
  sshComfyDpapiPath,
} from "./sshComfySecret.ts";
import type { SecretPlatform } from "./types.ts";

function memoryPlatform(): SecretPlatform & { creds: Map<string, Uint8Array>; writes: string[] } {
  const creds = new Map<string, Uint8Array>();
  const writes: string[] = [];
  return {
    writes,
    creds,
    credWrite(name, blob) {
      writes.push(`write:${name}`);
      creds.set(name, Uint8Array.from(blob));
    },
    credRead(name) {
      const found = creds.get(name);
      return found === undefined ? null : Uint8Array.from(found);
    },
    credDelete(name) {
      writes.push(`delete:${name}`);
      creds.delete(name);
    },
    protectData(plain) {
      const out = new Uint8Array(plain.byteLength + 1);
      out[0] = 0x5a;
      for (let i = 0; i < plain.byteLength; i += 1) {
        out[i + 1] = (plain[i] ?? 0) ^ 0xff;
      }
      return out;
    },
    unprotectData(cipher) {
      const out = new Uint8Array(Math.max(0, cipher.byteLength - 1));
      for (let i = 0; i < out.byteLength; i += 1) {
        out[i] = (cipher[i + 1] ?? 0) ^ 0xff;
      }
      return out;
    },
  };
}

async function filesContain(dir: string, needle: string): Promise<boolean> {
  const names = readdirSync(dir);
  for (const name of names) {
    const path = join(dir, name);
    const bytes = readFileSync(path);
    if (bytes.includes(Buffer.from(needle))) {
      return true;
    }
  }
  return false;
}

test("短密钥只进固定目标名，磁盘没有明文", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ssh-secret-"));
  const platform = memoryPlatform();
  const secret = Buffer.from("unit-ssh-secret-value", "utf8");
  try {
    await saveSshComfySecret({
      dataDir: dir,
      platform,
      restrictFile: async () => {},
      secret,
    });
    assert.deepEqual(platform.writes, [`write:${SSH_COMFY_CREDENTIAL_TARGET}`]);
    assert.equal(SSH_COMFY_CREDENTIAL_TARGET, "CanvasApp:ssh:comfy:account:default");
    assert.equal(existsSync(sshComfyDpapiPath(dir)), false);
    const read = readSshComfySecretSync(dir, platform);
    assert.equal(Buffer.from(read ?? []).toString("utf8"), "unit-ssh-secret-value");
    assert.equal(await filesContain(dir, "unit-ssh-secret-value"), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("超过 2560 字节只写另起名的 DPAPI 文件，不进凭据库，文件不是明文", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ssh-secret-long-"));
  const platform = memoryPlatform();
  const secret = new Uint8Array(CRED_MAX_CREDENTIAL_BLOB_SIZE + 1);
  secret.fill(0x61);
  try {
    await saveSshComfySecret({
      dataDir: dir,
      platform,
      restrictFile: async () => {},
      secret,
    });
    assert.equal(platform.writes.includes(`write:${SSH_COMFY_CREDENTIAL_TARGET}`), false);
    assert.equal(platform.creds.has(SSH_COMFY_CREDENTIAL_TARGET), false);
    const path = sshComfyDpapiPath(dir);
    assert.equal(path.endsWith(SSH_COMFY_DPAPI_FILENAME), true);
    const stored = new Uint8Array(await readFile(path));
    assert.equal(stored.includes(0x61), false);
    const read = readSshComfySecretSync(dir, platform);
    assert.equal(read?.byteLength, secret.byteLength);
    assert.equal(Buffer.from(read ?? []).equals(Buffer.from(secret)), true);
    deleteSshComfySecretSync(dir, platform);
    assert.equal(existsSync(path), false);
    assert.equal(readSshComfySecretSync(dir, platform), null);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
