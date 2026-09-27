/// <reference types="node" />
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const webSrc = here;
const repoRoot = join(here, "..", "..", "..");
const schemaSrc = join(repoRoot, "packages", "schema", "src");

function collectFiles(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "dist") {
      continue;
    }
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      collectFiles(full, acc);
      continue;
    }
    const ext = extname(name);
    if (ext === ".ts" || ext === ".tsx" || ext === ".css") {
      acc.push(full);
    }
  }
  return acc;
}

function isTestFile(path: string): boolean {
  return path.endsWith(".test.ts") || path.endsWith(".test.tsx");
}

/** 把禁令扫描要找的连续字面量拆开，测试仍按原词去扫产品源码。 */
function bannedToken(parts: readonly string[]): string {
  return parts.join("");
}

test("apps/web 产品源码不自行定义 resolvePrompt，只允许从 schema import", () => {
  const defineFn = /\bfunction\s+resolvePrompt\b/;
  const defineConst = /\bconst\s+resolvePrompt\s*=/;
  const files = collectFiles(webSrc).filter((file) => !isTestFile(file));
  assert.equal(files.length > 0, true);
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    assert.equal(defineFn.test(text), false, file);
    assert.equal(defineConst.test(text), false, file);
  }
  const schemaPrompt = readFileSync(join(schemaSrc, "resolvePrompt.ts"), "utf8");
  assert.equal(/\bexport\s+function\s+resolvePrompt\b/.test(schemaPrompt), true);
});

test("仓库没有另一套运行意图类型", () => {
  const define = new RegExp(String.raw`\b(?:type|interface)\s+${bannedToken(["Run", "Intent"])}\b`);
  const files = [...collectFiles(webSrc), ...collectFiles(schemaSrc)];
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    assert.equal(define.test(text), false, file);
  }
});

test("setText / EditorStore 用户编辑不打 execution/runs，不入队", () => {
  const storeSrc = readFileSync(join(webSrc, "canvas", "EditorStore.ts"), "utf8");
  assert.equal(storeSrc.includes("/api/execution/runs"), false);
  assert.equal(storeSrc.includes(bannedToken(["start", "Run"])), false);
  assert.equal(storeSrc.includes("CapabilityService"), false);
  const setStart = storeSrc.indexOf("setText(nodeId: string, text: string)");
  const setEnd = storeSrc.indexOf("replaceGraph(input:");
  assert.equal(setStart >= 0, true);
  assert.equal(setEnd > setStart, true);
  const setText = storeSrc.slice(setStart, setEnd);
  assert.equal(setText.includes("fetch("), false);
  assert.equal(setText.includes("this.staleOps"), true);
  const staleStart = storeSrc.indexOf("private staleOps(");
  assert.equal(staleStart >= 0, true);
  const stale = storeSrc.slice(staleStart, staleStart + 800);
  assert.equal(stale.includes("applyStaleFrom"), true);
  assert.equal(stale.includes("fetch("), false);
});

test("用户可见源码没有计算图节点类名", () => {
  const files = collectFiles(webSrc).filter((file) => !isTestFile(file));
  files.push(join(schemaSrc, "userFacingMessages.ts"));
  const sampler = bannedToken(["K", "Sampler"]);
  const vae = bannedToken(["V", "AE"]);
  const loadCkpt = bannedToken(["Load", " ", "Checkpoint"]);
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    assert.equal(text.includes(sampler), false, file);
    assert.equal(text.includes(vae), false, file);
    assert.equal(text.includes(loadCkpt), false, file);
  }
});

test("以后再做点击不调 onAddGeneration，主句来自 unimplementedCapabilityClick", () => {
  const toolbar = readFileSync(join(webSrc, "ui", "Toolbar.tsx"), "utf8");
  assert.equal(toolbar.includes("unimplementedCapabilityClick"), true);
  assert.equal(toolbar.includes("COPY.laterTitle"), true);
  const laterStart = toolbar.indexOf("data-later=");
  assert.equal(laterStart >= 0, true);
  const later = toolbar.slice(laterStart, laterStart + 500);
  assert.equal(later.includes("onAddGeneration"), false);
  assert.equal(later.includes("unimplementedCapabilityClick"), true);
  const copySrc = readFileSync(join(webSrc, "ui", "copy.ts"), "utf8");
  assert.equal(copySrc.includes('laterTitle: "以后再做"'), true);
  assert.equal(copySrc.includes("这一类还没接入。"), true);
  assert.equal(copySrc.includes("unimplementedCapabilityClick"), true);
});

test("编辑过期路径不 POST /api/execution/runs，运行按钮才经 execution 客户端 POST", () => {
  const files = collectFiles(webSrc).filter((file) => !isTestFile(file));
  const allowed = new Set([
    join(webSrc, "execution", "client.ts"),
    join(webSrc, "api", "client.ts"),
  ]);
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    if (!allowed.has(file)) {
      assert.equal(text.includes("/api/execution/runs"), false, file);
    }
    assert.equal(text.includes("createObjectURL"), false, file);
    assert.equal(text.includes("CapabilityService." + bannedToken(["start", "Run"])), false, file);
  }
  const app = readFileSync(join(webSrc, "App.tsx"), "utf8");
  assert.equal(app.includes("/api/execution/runs"), false);
  assert.equal(app.includes("createObjectURL"), false);
  const execClient = readFileSync(join(webSrc, "execution", "client.ts"), "utf8");
  assert.equal(execClient.includes("/api/execution/runs"), true);
});
