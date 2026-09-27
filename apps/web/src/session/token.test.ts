/// <reference types="node" />
import assert from "node:assert/strict";
import { test } from "node:test";
import { readSessionToken } from "./token.ts";

test("从 #token= 读取令牌", () => {
  assert.equal(readSessionToken({ hash: "#token=abc123", search: "" }), "abc123");
  assert.equal(readSessionToken({ hash: "#token=abc123&x=1", search: "" }), "abc123");
  assert.equal(readSessionToken({ hash: "#x=1&token=abc123", search: "" }), "abc123");
});

test("查询串里的 token 一律忽略", () => {
  assert.equal(readSessionToken({ hash: "", search: "?token=from-query" }), null);
  assert.equal(
    readSessionToken({ hash: "#token=from-hash", search: "?token=from-query" }),
    "from-hash",
  );
  assert.equal(readSessionToken({ hash: "#other=1", search: "?token=from-query" }), null);
});

test("空片段或空令牌为 null", () => {
  assert.equal(readSessionToken({ hash: "", search: "" }), null);
  assert.equal(readSessionToken({ hash: "#", search: "" }), null);
  assert.equal(readSessionToken({ hash: "#token=", search: "" }), null);
  assert.equal(readSessionToken({ hash: "#token=   ", search: "" }), null);
});
