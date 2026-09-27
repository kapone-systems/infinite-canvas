import { randomBytes } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { SESSION_TOKEN_FILE, VITE_DEV_PORT } from "./appData.ts";

export function generateSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

export function sessionTokenPath(dataDir: string): string {
  return join(dataDir, SESSION_TOKEN_FILE);
}

export async function writeSessionToken(dataDir: string, token: string): Promise<string> {
  const filePath = sessionTokenPath(dataDir);
  await writeFile(filePath, `${token}\n`, { encoding: "utf8", flag: "w" });
  return filePath;
}

/**
 * 有静态页（dist / --serve-web）时打印后端端口，否则打印 Vite 5173，
 * 这样「从终端新地址打开」能看见界面，而不是 401 JSON。
 */
export function publicUrlWithFragmentToken(port: number, token: string, serveWeb = false): string {
  const pagePort = serveWeb ? port : VITE_DEV_PORT;
  return `http://127.0.0.1:${pagePort}/#token=${token}`;
}
