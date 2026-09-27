import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveThumbSrc } from "./thumbSrc.ts";

test("缩略图地址只来自票据，失败时不退回原件路径", () => {
  const ready = resolveThumbSrc({ ticketId: "ticket-1", failed: false });
  assert.equal(ready.state, "thumb-ready");
  assert.equal(ready.src, "/api/media-ticket/ticket-1");
  assert.equal(ready.src?.includes("media/blobs"), false);
  assert.equal(ready.src?.startsWith("blob:"), false);

  const failed = resolveThumbSrc({ ticketId: "ticket-1", failed: true });
  assert.equal(failed.state, "thumb-failed");
  assert.equal(failed.src, null);

  const pending = resolveThumbSrc({ ticketId: null, failed: false });
  assert.equal(pending.state, "pending");
  assert.equal(pending.src, null);
});
