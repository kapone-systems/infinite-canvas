/// <reference types="node" />
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { createEmptyProject } from "@canvas/schema";
import { EditorStore } from "./EditorStore.ts";
import {
  adjacentSameRoleSlotId,
  applyFocusedTextHistoryKey,
  historyKeyAction,
  planSystemPaste,
  slotKeyPlan,
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

test("系统粘贴：输入框让出；文件优先；已复制节点时不把旧文字当成新文本", () => {
  assert.equal(planSystemPaste({ inField: true, fileCount: 2, text: "a", hasSessionClipboard: true }), "yield");
  assert.equal(planSystemPaste({ inField: false, fileCount: 2, text: "a", hasSessionClipboard: true }), "files");
  assert.equal(planSystemPaste({ inField: false, fileCount: 0, text: "你好", hasSessionClipboard: true }), "session");
  assert.equal(planSystemPaste({ inField: false, fileCount: 0, text: "x".repeat(100001), hasSessionClipboard: true }), "session");
  assert.equal(planSystemPaste({ inField: false, fileCount: 0, text: "你好", hasSessionClipboard: false }), "text");
  assert.equal(planSystemPaste({ inField: false, fileCount: 0, text: "x".repeat(100001), hasSessionClipboard: false }), "too-long");
  assert.equal(planSystemPaste({ inField: false, fileCount: 0, text: "", hasSessionClipboard: false }), "session");
  const shortcuts = readFileSync(join(dir, "shortcuts.ts"), "utf8");
  assert.equal(shortcuts.includes("pasteClipboard"), false);
  assert.equal(shortcuts.includes("navigator.clipboard"), false);
  const app = readFileSync(join(dir, "../App.tsx"), "utf8");
  assert.equal(app.includes("planSystemPaste"), true);
  assert.equal(app.includes("addImportedBatch"), true);
  assert.equal(app.includes("addTextAt"), true);
  assert.equal(app.includes("showDirectoryPicker"), false);
  const pasteAt = app.indexOf("const pasteWorld");
  const paste = app.slice(pasteAt, pasteAt + 3500);
  assert.equal(paste.includes("const onPaste"), true);
  assert.equal(paste.includes("image/svg+xml"), true);
  assert.equal(paste.includes("COPY_OFFSET"), true);
  assert.equal(paste.includes("getSnapshot().camera"), true);
});

test("槽键盘：Alt 上下重排，Delete 只断开，空槽 Backspace 才删槽", () => {
  assert.equal(slotKeyPlan({ key: "ArrowUp", altKey: true, slotFocused: true, slotEmpty: false }), "reorder-up");
  assert.equal(slotKeyPlan({ key: "ArrowDown", altKey: true, slotFocused: true, slotEmpty: true }), "reorder-down");
  assert.equal(slotKeyPlan({ key: "Delete", altKey: false, slotFocused: true, slotEmpty: false }), "disconnect");
  assert.equal(slotKeyPlan({ key: "Backspace", altKey: false, slotFocused: true, slotEmpty: true }), "remove");
  assert.equal(slotKeyPlan({ key: "Backspace", altKey: false, slotFocused: true, slotEmpty: false }), null);
  assert.equal(slotKeyPlan({ key: "Delete", altKey: false, slotFocused: false, slotEmpty: false }), "delete-selection");
  assert.equal(slotKeyPlan({ key: "Backspace", altKey: false, slotFocused: false, slotEmpty: false }), "delete-selection");
  const slots = [
    { id: "p", role: "prompt", order: 0 },
    { id: "a", role: "reference_image", order: 1 },
    { id: "b", role: "reference_image", order: 2 },
  ];
  assert.equal(adjacentSameRoleSlotId(slots, "b", "up"), "a");
  assert.equal(adjacentSameRoleSlotId(slots, "a", "down"), "b");
  assert.equal(adjacentSameRoleSlotId(slots, "a", "up"), null);
  assert.equal(adjacentSameRoleSlotId(slots, "p", "down"), null);
  const shortcuts = readFileSync(join(dir, "shortcuts.ts"), "utf8");
  const keyAt = shortcuts.indexOf("const onKeyDown");
  const key = shortcuts.slice(keyAt, keyAt + 3500);
  const planAt = key.indexOf("slotKeyPlan");
  const deleteAt = key.indexOf("deleteSelection");
  assert.ok(planAt >= 0 && deleteAt > planAt);
});


