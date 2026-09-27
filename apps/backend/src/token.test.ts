import assert from "node:assert/strict";
import { test } from "node:test";
import { VITE_DEV_PORT } from "./appData.ts";
import { publicUrlWithFragmentToken } from "./token.ts";

test("有静态页时终端地址用后端端口，否则用 Vite 5173，令牌只在片段", () => {
  const token = "abc_token";
  const withWeb = publicUrlWithFragmentToken(8787, token, true);
  assert.equal(withWeb, `http://127.0.0.1:8787/#token=${token}`);
  const dev = publicUrlWithFragmentToken(8787, token, false);
  assert.equal(dev, `http://127.0.0.1:${VITE_DEV_PORT}/#token=${token}`);
  assert.equal(dev.includes("?token="), false);
  assert.match(dev, /#token=/);
});
