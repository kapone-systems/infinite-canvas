/// <reference types="node" />
import assert from "node:assert/strict";
import { test } from "node:test";
import { createEmptyProject, type ProjectNode } from "@canvas/schema";
import {
  applyOps,
  CommandHistory,
  createHistoryEntry,
  moveNodesEntry,
  textCoalesceKey,
  type HistoryEntry,
  type Op,
} from "./history.ts";
import { HISTORY_LIMIT } from "./metrics.ts";

const NOW = "2026-09-24T00:00:00.000Z";

function emptyDoc() {
  return createEmptyProject({
    projectId: "p1",
    name: "demo",
    now: new Date(NOW),
  });
}

function textNode(id: string, x: number, y: number, text = ""): ProjectNode {
  return {
    id,
    kind: "text",
    title: id,
    x,
    y,
    width: 280,
    height: 180,
    z: 1,
    groupId: null,
    origin: "authored",
    createdAt: NOW,
    updatedAt: NOW,
    outputRevision: 1,
    text,
  };
}

test("Op / HistoryEntry 字段与阶段 2 原文一致", () => {
  const node = textNode("n1", 0, 0);
  const redo: Op[] = [{ op: "put-node", node }];
  const entry: HistoryEntry = createHistoryEntry({
    id: "e1",
    label: "添加文本节点",
    redo,
    coalesceKey: textCoalesceKey("n1", "text"),
    selectAfterRedo: ["n1"],
    selectAfterUndo: [],
  });
  assert.equal(entry.id, "e1");
  assert.equal(entry.label, "添加文本节点");
  assert.equal(entry.coalesceKey, "text:n1:text");
  assert.deepEqual(entry.selectAfterRedo, ["n1"]);
  assert.deepEqual(entry.selectAfterUndo, []);
  assert.equal(entry.redo[0]?.op, "put-node");
  assert.equal(entry.undo[0]?.op, "drop-node");
});

test("undo / redo 能把节点坐标还原，重做栈在新命令后清空", () => {
  let doc = emptyDoc();
  doc.nodes["a"] = textNode("a", 0, 0);
  const history = new CommandHistory();
  const entry = moveNodesEntry({
    id: "drag-1",
    moves: [{ id: "a", prev: { x: 0, y: 0 }, next: { x: 24, y: 8 } }],
    select: ["a"],
  });
  history.push(entry);
  doc = applyOps(doc, entry.redo);
  assert.equal(doc.nodes["a"]?.x, 24);
  assert.equal(doc.nodes["a"]?.y, 8);
  const undone = history.undo();
  assert.ok(undone);
  doc = applyOps(doc, undone.undo);
  assert.equal(doc.nodes["a"]?.x, 0);
  assert.equal(doc.nodes["a"]?.y, 0);
  const redone = history.redo();
  assert.ok(redone);
  doc = applyOps(doc, redone.redo);
  assert.equal(doc.nodes["a"]?.x, 24);
  history.push(
    moveNodesEntry({
      id: "drag-2",
      moves: [{ id: "a", prev: { x: 24, y: 8 }, next: { x: 40, y: 8 } }],
      select: ["a"],
    }),
  );
  assert.equal(history.canRedo(), false);
});

test("coalesceKey 相同收成一条；撤销一次回到合并窗口之前", () => {
  let doc = emptyDoc();
  doc.nodes["n1"] = textNode("n1", 0, 0, "");
  const history = new CommandHistory();
  const key = textCoalesceKey("n1", "text");
  const first = createHistoryEntry({
    id: "t1",
    label: "编辑文本",
    redo: [{ op: "set", path: "nodes.n1.text", value: "上", prev: "" }],
    coalesceKey: key,
    selectAfterRedo: ["n1"],
    selectAfterUndo: ["n1"],
  });
  history.push(first);
  doc = applyOps(doc, first.redo);
  const second = createHistoryEntry({
    id: "t2",
    label: "编辑文本",
    redo: [{ op: "set", path: "nodes.n1.text", value: "上游改过", prev: "上" }],
    coalesceKey: key,
    selectAfterRedo: ["n1"],
    selectAfterUndo: ["n1"],
  });
  history.push(second);
  doc = applyOps(doc, second.redo);
  assert.equal(history.depth(), 1);
  assert.equal(doc.nodes["n1"]?.text, "上游改过");
  const undone = history.undo();
  assert.ok(undone);
  assert.equal(undone.id, "t1");
  const textUndo = undone.undo[0];
  assert.ok(textUndo && textUndo.op === "set");
  assert.equal(textUndo.value, "");
  doc = applyOps(doc, undone.undo);
  assert.equal(doc.nodes["n1"]?.text, "");
  const redone = history.redo();
  assert.ok(redone);
  const textRedo = redone.redo[0];
  assert.ok(textRedo && textRedo.op === "set");
  assert.equal(textRedo.value, "上游改过");
  assert.equal(textRedo.prev, "");
  doc = applyOps(doc, redone.redo);
  assert.equal(doc.nodes["n1"]?.text, "上游改过");
});

test("栈深 100：超过丢掉最旧一条", () => {
  assert.equal(HISTORY_LIMIT, 100);
  const history = new CommandHistory();
  for (let i = 0; i < 101; i += 1) {
    history.push(
      createHistoryEntry({
        id: `e${i}`,
        label: `op ${i}`,
        redo: [{ op: "set", path: "name", value: `n${i}`, prev: `n${i - 1}` }],
        selectAfterRedo: [],
        selectAfterUndo: [],
      }),
    );
  }
  assert.equal(history.depth(), 100);
  const firstUndo = history.undo();
  assert.equal(firstUndo?.id, "e100");
  let oldest: ReturnType<CommandHistory["undo"]> = firstUndo;
  while (history.canUndo()) {
    oldest = history.undo();
  }
  assert.equal(oldest?.id, "e1");
});

test("拖拽过程不入栈，松手一步：一次撤销回到起点", () => {
  let doc = emptyDoc();
  doc.nodes["a"] = textNode("a", 0, 0);
  doc.nodes["b"] = textNode("b", 40, 0);
  const history = new CommandHistory();
  let liveA = { x: 0, y: 0 };
  for (const x of [4, 10, 18, 24]) {
    liveA = { x, y: 0 };
  }
  assert.equal(history.depth(), 0);
  const entry = moveNodesEntry({
    id: "drag",
    moves: [
      { id: "a", prev: { x: 0, y: 0 }, next: liveA },
      { id: "b", prev: { x: 40, y: 0 }, next: { x: 64, y: 0 } },
    ],
    select: ["a", "b"],
  });
  history.push(entry);
  doc = applyOps(doc, entry.redo);
  assert.equal(history.depth(), 1);
  assert.equal(doc.nodes["a"]?.x, 24);
  assert.equal(doc.nodes["b"]?.x, 64);
  const undone = history.undo();
  assert.ok(undone);
  doc = applyOps(doc, undone.undo);
  assert.equal(doc.nodes["a"]?.x, 0);
  assert.equal(doc.nodes["a"]?.y, 0);
  assert.equal(doc.nodes["b"]?.x, 40);
  assert.equal(history.depth(), 0);
  assert.equal(history.canRedo(), true);
});

test("不同 coalesceKey 或无 key 的拖拽不合并", () => {
  const history = new CommandHistory();
  history.push(
    moveNodesEntry({
      id: "d1",
      moves: [{ id: "a", prev: { x: 0, y: 0 }, next: { x: 1, y: 0 } }],
      select: ["a"],
    }),
  );
  history.push(
    moveNodesEntry({
      id: "d2",
      moves: [{ id: "a", prev: { x: 1, y: 0 }, next: { x: 2, y: 0 } }],
      select: ["a"],
    }),
  );
  assert.equal(history.depth(), 2);
});
