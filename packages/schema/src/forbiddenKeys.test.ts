import assert from "node:assert/strict";
import { test } from "node:test";
import {
  findForbiddenDataUri,
  findForbiddenKey,
  FORBIDDEN_DATA_URI_PREFIXES,
  FORBIDDEN_KEYS,
  isForbiddenKey,
} from "./forbiddenKeys.ts";

test("完整密钥键名忽略大小写均命中，secretRef 不是密钥键", () => {
  for (const key of FORBIDDEN_KEYS) {
    assert.equal(isForbiddenKey(key), true, key);
    assert.equal(isForbiddenKey(key.toUpperCase()), true, key.toUpperCase());
  }
  assert.equal(isForbiddenKey("secretRef"), false);
  assert.equal(isForbiddenKey("providerId"), false);
});

test("递归出现 apiKey 等完整键则找出该键", () => {
  assert.equal(findForbiddenKey({ nodes: { a: { apiKey: "x" } } }), "apiKey");
  assert.equal(findForbiddenKey({ nested: [{ TOKEN: "t" }] }), "TOKEN");
  assert.equal(
    findForbiddenKey({
      nodes: {
        n1: { secretRef: { providerId: "example.cloud", account: "default" } },
      },
    }),
    null,
  );
});

test("data:image/ video/ audio/ application/ 前缀拒绝", () => {
  for (const prefix of FORBIDDEN_DATA_URI_PREFIXES) {
    assert.equal(findForbiddenDataUri(`${prefix}png;base64,aaa`), prefix);
  }
  assert.equal(findForbiddenDataUri("data:text/plain,hello"), null);
  assert.equal(
    findForbiddenDataUri({ text: "data:application/octet-stream;base64,aa" }),
    "data:application/",
  );
});
