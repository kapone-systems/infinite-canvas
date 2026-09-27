/// <reference types="node" />
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { createEmptyProject } from "@canvas/schema";
import { EditorStore } from "./EditorStore.ts";
import {
  applyFocusedTextHistoryKey,
  historyKeyAction,
} from "./shortcuts.ts";

const dir = dirname(fileURLToPath(import.meta.url));

function keyEvent(partial: {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
}): {
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  key: string;
  preventDefaultCount: number;
  stopPropagationCount: number;
  preventDefault(): void;
  stopPropagation(): void;
} {
  const event = {
    ctrlKey: partial.ctrlKey === true,
    metaKey: partial.metaKey === true,
    shiftKey: partial.shiftKey === true,
    key: partial.key,
    preventDefaultCount: 0,
    stopPropagationCount: 0,
    preventDefault(): void {
      event.preventDefaultCount += 1;
    },
    stopPropagation(): void {
      event.stopPropagationCount += 1;
    },
  };
  return event;
}

test("Ctrl/Meta+Z 为撤销，Y 与 Shift+Z 为重做", () => {
  assert.equal(historyKeyAction({ ctrlKey: true, metaKey: false, shiftKey: false, key: "z" }), "undo");
  assert.equal(historyKeyAction({ ctrlKey: false, metaKey: true, shiftKey: false, key: "Z" }), "undo");
  assert.equal(historyKeyAction({ ctrlKey: true, metaKey: false, shiftKey: false, key: "y" }), "redo");
  assert.equal(historyKeyAction({ ctrlKey: true, metaKey: false, shiftKey: true, key: "z" }), "redo");
  assert.equal(historyKeyAction({ ctrlKey: false, metaKey: false, shiftKey: false, key: "z" }), null);
  assert.equal(historyKeyAction({ ctrlKey: true, metaKey: false, shiftKey: false, key: "a" }), null);
});

test("聚焦文本框 Ctrl+Z 走命令栈：上屏后撤销一次整句消失", () => {
  const store = new EditorStore({
    idFactory: () => "node-1",
    now: () => new Date("2026-09-24T00:00:00.000Z"),
  });
  store.loadProject(
    createEmptyProject({
      projectId: "p1",
      name: "demo",
      now: new Date("2026-09-24T00:00:00.000Z"),
    }),
  );
  store.addTextNode();
  store.setText("node-1", "上游改过");
  assert.equal(store.getSnapshot().nodes[0]?.text, "上游改过");

  const event = keyEvent({ key: "z", ctrlKey: true });
  const handled = applyFocusedTextHistoryKey(event, {
    composing: false,
    undo: () => {
      store.undo();
    },
    redo: () => {
      store.redo();
    },
  });
  assert.equal(handled, true);
  assert.equal(event.preventDefaultCount, 1);
  assert.equal(event.stopPropagationCount, 1);
  assert.equal(store.getSnapshot().nodes[0]?.text, "");
});

test("组字中 Ctrl+Z 不提交命令栈", () => {
  let undone = 0;
  const event = keyEvent({ key: "z", ctrlKey: true });
  const handled = applyFocusedTextHistoryKey(event, {
    composing: true,
    undo: () => {
      undone += 1;
    },
    redo: () => {
      undone += 1;
    },
  });
  assert.equal(handled, true);
  assert.equal(event.preventDefaultCount, 1);
  assert.equal(undone, 0);
});

test("聚焦 Ctrl+Y 走命令栈重做", () => {
  const store = new EditorStore({
    idFactory: () => "node-1",
    now: () => new Date("2026-09-24T00:00:00.000Z"),
  });
  store.loadProject(
    createEmptyProject({
      projectId: "p1",
      name: "demo",
      now: new Date("2026-09-24T00:00:00.000Z"),
    }),
  );
  store.addTextNode();
  store.setText("node-1", "上游改过");
  store.undo();
  const event = keyEvent({ key: "y", ctrlKey: true });
  applyFocusedTextHistoryKey(event, {
    composing: false,
    undo: () => {
      store.undo();
    },
    redo: () => {
      store.redo();
    },
  });
  assert.equal(store.getSnapshot().nodes[0]?.text, "上游改过");
});

test("TextNode 聚焦路径接到 applyFocusedTextHistoryKey；App 接到 store.undo/redo", () => {
  const textNode = readFileSync(join(dir, "TextNode.tsx"), "utf8");
  assert.equal(textNode.includes("applyFocusedTextHistoryKey"), true);
  assert.equal(textNode.includes("onUndo"), true);
  assert.equal(textNode.includes("onRedo"), true);
  assert.equal(textNode.includes("props.onUndo"), true);
  assert.equal(textNode.includes("props.onRedo"), true);
  const app = readFileSync(join(dir, "../App.tsx"), "utf8");
  assert.equal(app.includes("onUndo"), true);
  assert.equal(app.includes("onRedo"), true);
  assert.equal(app.includes("store.undo()"), true);
  assert.equal(app.includes("store.redo()"), true);
});
