import type { IncomingMessage, ServerResponse } from "node:http";
import { USER_FACING } from "@canvas/schema";
import { BACKEND_MESSAGES } from "../messages.ts";
import { SecretRefInvalidError, SecretStoreRejectedError, normalizeSecretRef } from "../secrets/secretRef.ts";
import type { SecretStore } from "../secrets/types.ts";
import { sendJson } from "./guard.ts";

const PROVIDER_PATH = /^\/api\/secrets\/([^/]+)$/;

function recordOf(body: unknown): Record<string, unknown> | null {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return null;
  }
  return body as Record<string, unknown>;
}

function accountFrom(value: unknown): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string") {
    return "";
  }
  return value;
}

export async function handleSecrets(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  body: unknown,
  store: SecretStore,
): Promise<boolean> {
  const method = (req.method ?? "GET").toUpperCase();
  const path = url.pathname;
  if (path !== "/api/secrets" && !PROVIDER_PATH.test(path)) {
    return false;
  }

  try {
    if (path === "/api/secrets" && method === "PUT") {
      const record = recordOf(body);
      if (record === null || typeof record.providerId !== "string" || typeof record.secret !== "string" || record.secret.length === 0) {
        sendJson(res, 400, { message: BACKEND_MESSAGES.requestFailed });
        return true;
      }
      const account = accountFrom(record.account);
      if (account === "") {
        sendJson(res, 400, { message: BACKEND_MESSAGES.requestFailed });
        return true;
      }
      const ref = normalizeSecretRef(record.providerId, account);
      if (ref === null) {
        sendJson(res, 400, { message: BACKEND_MESSAGES.requestFailed });
        return true;
      }
      await store.put(ref, new TextEncoder().encode(record.secret));
      res.writeHead(204, { "Cache-Control": "no-store" });
      res.end();
      return true;
    }

    const match = PROVIDER_PATH.exec(path);
    if (match === null) {
      return false;
    }
    let providerId: string;
    try {
      providerId = decodeURIComponent(match[1] ?? "");
    } catch {
      sendJson(res, 400, { message: BACKEND_MESSAGES.requestFailed });
      return true;
    }
    const accountParam = url.searchParams.get("account") ?? undefined;
    const ref = normalizeSecretRef(providerId, accountParam ?? undefined);
    if (ref === null) {
      sendJson(res, 400, { message: BACKEND_MESSAGES.requestFailed });
      return true;
    }
    if (method === "GET") {
      const present = await store.present(ref);
      sendJson(res, 200, { present });
      return true;
    }
    if (method === "DELETE") {
      await store.delete(ref);
      res.writeHead(204, { "Cache-Control": "no-store" });
      res.end();
      return true;
    }
    return false;
  } catch (err) {
    if (res.headersSent) {
      return true;
    }
    if (err instanceof SecretStoreRejectedError) {
      sendJson(res, 400, { message: USER_FACING.secretStoreRejected });
      return true;
    }
    if (err instanceof SecretRefInvalidError) {
      sendJson(res, 400, { message: BACKEND_MESSAGES.requestFailed });
      return true;
    }
    sendJson(res, 400, { message: BACKEND_MESSAGES.requestFailed });
    return true;
  }
}
