/// <reference types="node" />
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  createEmptyProject,
  roleDisplayIndex,
  slotTitle,
  TEXT_MAX_CHARS,
  USER_FACING,
  type ProjectNode,
  type RunRequest,
} from "@canvas/schema";
import { DEFAULT_NODE_SIZE } from "@canvas/schema";
import { COPY, portOccupiedMessage, unimplementedCapabilityClick } from "../ui/copy.ts";
import { createCopyInternalEdgesFixture } from "../fixtures/generate.ts";
import { fixtureImageMediaRef } from "../fixtures/media.ts";
import { EditorStore } from "./EditorStore.ts";
import { generationPreviewText } from "./document.ts";
import { versionLabel } from "./versionLabel.ts";
import { decideExtractCommit } from "./gestures.ts";
import { COPY_OFFSET, generationNodeHeight } from "./metrics.ts";

function storeWithEmpty(idFactory?: () => string): EditorStore {
  let n = 0;
  const store = new EditorStore({
    idFactory: idFactory ?? (() => `node-${++n}`),
    now: () => new Date("2026-09-24T00:00:00.000Z"),
  });
  store.loadProject(
    createEmptyProject({
      projectId: "p1",
      name: "demo",
      now: new Date("2026-09-24T00:00:00.000Z"),
    }),
  );
  return store;
}

test("添加文本节点默认 280×180，放在相机中心，立刻标脏并需要 PUT 工作副本", () => {
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
  assert.equal(store.getSnapshot().empty, true);
  assert.equal(store.getSnapshot().unsaved, false);
  const id = store.addTextNode();
  assert.equal(id, "node-1");
  const snap = store.getSnapshot();
  assert.equal(snap.empty, false);
  assert.equal(snap.unsaved, true);
  assert.equal(snap.needsWorkingCopySync, true);
  const node = snap.nodes[0];
  assert.ok(node);
  assert.equal(node.kind, "text");
  assert.equal(node.width, DEFAULT_NODE_SIZE.text.width);
  assert.equal(node.height, DEFAULT_NODE_SIZE.text.height);
  assert.equal(node.width, 280);
  assert.equal(node.height, 180);
  assert.equal(node.x, -140);
  assert.equal(node.y, -90);
  const body = store.workingCopyBody();
  assert.ok(body);
  assert.equal(body.contentRevision, 0);
  assert.equal(body.nodes["node-1"]?.text, "");
  assert.deepEqual(body.edges, {});
  assert.deepEqual(body.groups, {});
});

test("已上屏且字符串变了才标脏；相同字符串不 PUT", () => {
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
  store.acknowledgeWorkingCopy(1, store.syncGeneration());
  assert.equal(store.getSnapshot().needsWorkingCopySync, false);
  const same = store.setText("node-1", "");
  assert.equal(same.ok, true);
  if (same.ok) {
    assert.equal(same.changed, false);
  }
  assert.equal(store.getSnapshot().needsWorkingCopySync, false);
  const changed = store.setText("node-1", "一只纸船");
  assert.equal(changed.ok, true);
  if (changed.ok) {
    assert.equal(changed.changed, true);
  }
  assert.equal(store.getSnapshot().unsaved, true);
  assert.equal(store.getSnapshot().needsWorkingCopySync, true);
  assert.equal(store.getSnapshot().nodes[0]?.text, "一只纸船");
  assert.equal(store.getSnapshot().nodes[0]?.outputRevision, 2);
});

test("文本超过 100000 不放进节点", () => {
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
  const result = store.setText("node-1", "x".repeat(TEXT_MAX_CHARS + 1));
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.message, USER_FACING.textTooLong);
    assert.equal(result.message, "文本太长，没有放进节点。");
  }
  assert.equal(store.getSnapshot().nodes[0]?.text, "");
});

test("只改相机不点亮未保存、不 PUT 工作副本", () => {
  const store = storeWithEmpty(() => "node-1");
  assert.equal(store.getSnapshot().unsaved, false);
  store.setCamera({ x: 12, y: -4, zoom: 1.25 });
  const snap = store.getSnapshot();
  assert.equal(snap.unsaved, false);
  assert.equal(snap.needsWorkingCopySync, false);
  assert.equal(snap.camera.x, 12);
  assert.equal(snap.camera.y, -4);
  assert.equal(snap.camera.zoom, 1.25);
});

test("阶段 1 主句与端口占用句可用；已选 N 个", () => {
  assert.equal(COPY.backendNeverConnected, "本机服务没连上");
  assert.equal(COPY.retryConnection, "重试连接");
  assert.equal(COPY.noProject, "还没有工程");
  assert.equal(COPY.emptyCanvas, "画布是空的");
  assert.equal(COPY.emptyCanvasHint, "从左侧加上文本或生成，或把图片拖进来");
  assert.equal(COPY.staleHover, "上游改过了，不会自动重跑。");
  assert.equal(COPY.notImplemented, "这一类还没接入。");
  assert.equal(COPY.runThisNode, "运行此节点");
  assert.equal(COPY.runDownstream, "运行下游");
  assert.equal(COPY.runSelection, "运行选中部分");
  assert.equal(
    COPY.runFreshConfirm,
    "当前结果还没过期。再跑会新增一个版本，旧结果还留在版本里，不会被盖掉。",
  );
  assert.equal(
    COPY.runSelectionConfirm,
    "选中的生成节点都会再跑，包括还没过期的。每个都会新增版本。",
  );
  assert.equal(COPY.runDisabledText, "文本不用跑。改字之后，用到它的节点会标成过期。");
  assert.equal(COPY.textKindLabel, "文本");
  assert.equal(COPY.selectedCount(2), "已选 2 个");
  assert.equal(USER_FACING.selectedCount(3), "已选 3 个");
  assert.equal(COPY.emptyGenerationPreview, "运行后，结果会出现在这里");
  assert.equal(
    portOccupiedMessage(8787),
    "端口 8787 已被占用。如果画布后端已经在运行，请打开原来的地址；否则换一个端口再启动。",
  );
});

test("保存成功后未保存消失", () => {
  const store = storeWithEmpty(() => "node-1");
  store.addTextNode();
  store.acknowledgeWorkingCopy(1, store.syncGeneration());
  assert.equal(store.getSnapshot().unsaved, true);
  store.markSaved(1, 1);
  assert.equal(store.getSnapshot().unsaved, false);
});

test("拖一步入栈，撤销一次回到起点并 rebuildSpatial", () => {
  const store = storeWithEmpty(() => "a");
  store.addTextNode();
  const start = store.getSnapshot().nodes[0];
  assert.ok(start);
  store.select(["a"]);
  store.moveNodes(["a"], 40, 8);
  assert.equal(store.getSnapshot().nodes[0]?.x, start.x + 40);
  assert.equal(store.getSnapshot().canUndo, true);
  store.undo();
  assert.equal(store.getSnapshot().nodes[0]?.x, start.x);
  assert.equal(store.getSnapshot().nodes[0]?.y, start.y);
  const hits = store.querySpatial({ x: start.x, y: start.y, width: 10, height: 10 });
  assert.equal(hits.includes("a"), true);
});

test("复制只含内部边；排队态不继承任务", () => {
  const fixture = createCopyInternalEdgesFixture();
  const running = fixture.project.nodes[fixture.innerGenerationId];
  assert.ok(running);
  running.phase = "queued";
  running.lastRunId = "run-1";
  running.lastTaskId = "task-1";
  let n = 0;
  const store = new EditorStore({
    idFactory: () => `copy-${n++}`,
    now: () => new Date("2026-09-24T00:00:00.000Z"),
  });
  store.loadProject(fixture.project);
  store.select([...fixture.copyNodeIds]);
  store.copySelection();
  const pasted = store.pasteClipboard();
  assert.equal(pasted.length, 2);
  const body = store.workingCopyBody();
  assert.ok(body);
  const newEdges = Object.values(body.edges).filter((edge) => fixture.project.edges[edge.id] === undefined);
  assert.equal(newEdges.length, 1);
  const newTargets = new Set(newEdges.map((edge) => edge.targetNodeId));
  assert.equal(newTargets.has(fixture.outsideNodeId), false);
  for (const id of pasted) {
    const node: ProjectNode | undefined = body.nodes[id];
    assert.ok(node);
    if (node.kind === "generation") {
      assert.equal(node.phase, "idle");
      assert.equal(node.lastRunId ?? null, null);
      assert.equal(node.lastTaskId ?? null, null);
      assert.equal(node.x, running.x + COPY_OFFSET);
    }
  }
});

test("Ctrl+G 至少两个节点；组拖 moveNodes 跟手", () => {
  const store = storeWithEmpty();
  const a = store.addTextNode();
  const b = store.addTextNode();
  assert.ok(a && b);
  store.select([a]);
  const tooFew = store.groupSelected();
  assert.equal(tooFew.ok, false);
  store.select([a, b]);
  const grouped = store.groupSelected();
  assert.equal(grouped.ok, true);
  if (!grouped.ok) {
    return;
  }
  const beforeA = store.nodeMap()[a];
  const beforeB = store.nodeMap()[b];
  assert.ok(beforeA && beforeB);
  const ax = beforeA.x;
  const bx = beforeB.x;
  store.select([grouped.groupId]);
  store.moveNodes([grouped.groupId], 10, 0);
  assert.equal(store.nodeMap()[a]?.x, ax + 10);
  assert.equal(store.nodeMap()[b]?.x, bx + 10);
});

test("replaceGraph 不写死 revision 0，保留当前 contentRevision", () => {
  const store = storeWithEmpty(() => "n");
  store.addTextNode();
  store.acknowledgeWorkingCopy(4, store.syncGeneration());
  assert.equal(store.workingCopyBody()?.contentRevision, 4);
  store.replaceGraph({ nodes: {}, edges: {}, groups: {} });
  assert.equal(store.workingCopyBody()?.contentRevision, 4);
  assert.equal(store.getSnapshot().empty, true);
  assert.equal(store.getSnapshot().needsWorkingCopySync, true);
});

test("上屏后撤销一次整句消失", () => {
  const store = storeWithEmpty(() => "node-1");
  store.addTextNode();
  store.setText("node-1", "上游改过");
  assert.equal(store.getSnapshot().nodes[0]?.text, "上游改过");
  store.undo();
  assert.equal(store.getSnapshot().nodes[0]?.text, "");
});

test("Delete 调预留 cancel；G<2 不成组", () => {
  const cancelled: string[][] = [];
  const store = new EditorStore({
    idFactory: () => "node-1",
    now: () => new Date("2026-09-24T00:00:00.000Z"),
    onCancelExecution: (ids) => {
      cancelled.push([...ids]);
    },
  });
  store.loadProject(
    createEmptyProject({
      projectId: "p1",
      name: "demo",
      now: new Date("2026-09-24T00:00:00.000Z"),
    }),
  );
  store.addTextNode();
  const node = store.nodeMap()["node-1"];
  assert.ok(node);
  node.phase = "running";
  store.select(["node-1"]);
  store.deleteSelection();
  assert.deepEqual(cancelled, [["node-1"]]);
  assert.equal(store.getSnapshot().nodes.length, 0);
});

function semanticStore(): EditorStore {
  let n = 0;
  const store = new EditorStore({
    idFactory: () => `id-${++n}`,
    now: () => new Date("2026-09-24T00:00:00.000Z"),
  });
  store.loadProject(
    createEmptyProject({
      projectId: "p1",
      name: "demo",
      now: new Date("2026-09-24T00:00:00.000Z"),
    }),
  );
  return store;
}

test("演示1：文本连提示词；文本→参考图回弹句；自环/成环/视频", () => {
  const store = semanticStore();
  const textId = store.addTextNode();
  const txt2 = store.addGenerationNode("txt2img");
  const refId = store.addGenerationNode("reference");
  assert.ok(textId && txt2 && refId);
  const txtNode = store.nodeMap()[txt2];
  const promptSlot = txtNode?.slots?.find((slot) => slot.role === "prompt");
  assert.ok(txtNode && promptSlot);
  assert.equal(slotTitle(txtNode.slots ?? [], promptSlot), "提示词");
  const ok = store.connectToSlot(textId, txt2, promptSlot.id);
  assert.equal(ok.ok, true);
  const promptEdge = Object.values(store.edgeMap()).find((edge) => edge.targetSlotId === promptSlot.id);
  assert.ok(promptEdge);
  assert.equal(promptEdge.role, "prompt");
  assert.equal(promptEdge.sourceNodeId, textId);

  const refNode = store.nodeMap()[refId];
  const refSlot = refNode?.slots?.find((slot) => slot.role === "reference_image");
  assert.ok(refNode && refSlot);
  const edgesBeforeMismatch = Object.keys(store.edgeMap()).length;
  const mismatch = store.connectToSlot(textId, refId, refSlot.id);
  assert.equal(mismatch.ok, false);
  if (!mismatch.ok) {
    assert.equal(mismatch.message, "这里要的是参考图，这条线是提示词");
    assert.equal(mismatch.message, USER_FACING.textToReferenceImage);
  }
  assert.equal(store.getSnapshot().lastConnectMessage, "这里要的是参考图，这条线是提示词");
  assert.equal(store.nodeMap()[refId]?.slots?.find((slot) => slot.id === refSlot.id)?.edgeId, null);
  assert.equal(Object.keys(store.edgeMap()).length, edgesBeforeMismatch);
  assert.equal(
    Object.values(store.edgeMap()).some((edge) => edge.targetSlotId === refSlot.id),
    false,
  );

  const self = store.connectToSlot(txt2, txt2, promptSlot.id);
  assert.equal(self.ok, false);
  if (!self.ok) {
    assert.equal(self.message, "不能连到自己");
  }

  const blank = store.connect(textId, { type: "empty" });
  assert.equal(blank.ok, false);
  if (!blank.ok) {
    assert.equal(blank.message, "要连到槽上，已取消");
  }
  const far = store.connect(textId, { type: "far" });
  assert.equal(far.ok, false);
  if (!far.ok) {
    assert.equal(far.message, "放大到能看清槽之后再松开");
  }
});

test("演示2：参考图默认 1 参考槽；添加槽；两槽对调序号跟着走", () => {
  const store = semanticStore();
  const id = store.addGenerationNode("reference");
  assert.ok(id);
  const node = store.nodeMap()[id];
  assert.ok(node);
  const roles = node.slots?.map((slot) => slot.role);
  assert.deepEqual(roles, ["prompt", "reference_image"]);
  assert.deepEqual(store.addableRoles(id).includes("prompt"), false);
  assert.equal(store.addableRoles(id).includes("reference_image"), true);
  const added = store.addSlot(id, "reference_image");
  assert.equal(added.ok, true);
  const thirdAdded = store.addSlot(id, "reference_image");
  assert.equal(thirdAdded.ok, true);
  const styleAdded = store.addSlot(id, "style_reference");
  assert.equal(styleAdded.ok, true);
  const after = store.nodeMap()[id];
  assert.ok(after?.slots);
  const refs = after.slots.filter((slot) => slot.role === "reference_image").sort((a, b) => a.order - b.order);
  assert.equal(refs.length, 3);
  const first = refs[0];
  const second = refs[1];
  const third = refs[2];
  assert.ok(first && second && third);
  assert.equal(roleDisplayIndex(after.slots, third), 3);
  assert.equal(store.reorderSlots(id, first.id, second.id), true);
  const swappedNode = store.nodeMap()[id];
  assert.ok(swappedNode?.slots);
  const swapped = swappedNode.slots
    .filter((slot) => slot.role === "reference_image")
    .sort((a, b) => a.order - b.order);
  assert.equal(swapped[0]?.id, second.id);
  assert.equal(swapped[1]?.id, first.id);
  assert.equal(swapped[2]?.id, third.id);
  assert.equal(slotTitle(swappedNode.slots, swapped[0]!), "参考图 1");
  assert.equal(slotTitle(swappedNode.slots, swapped[1]!), "参考图 2");
  assert.equal(roleDisplayIndex(swappedNode.slots, swapped[2]!), 3);
  assert.equal(slotTitle(swappedNode.slots, swapped[2]!), "参考图 3");
  const prompt = swappedNode.slots.find((slot) => slot.role === "prompt");
  const style = swappedNode.slots.find((slot) => slot.role === "style_reference");
  assert.ok(prompt && style);
  assert.equal(slotTitle(swappedNode.slots, prompt), "提示词");
  assert.equal(slotTitle(swappedNode.slots, style), "风格参考");
});

test("交换两个参考槽：目标过期，源不过期", () => {
  const store = semanticStore();
  const target = store.addGenerationNode("reference");
  const srcA = store.addGenerationNode("txt2img");
  const srcB = store.addGenerationNode("txt2img");
  assert.ok(target && srcA && srcB);
  assert.equal(store.addSlot(target, "reference_image").ok, true);
  const media = fixtureImageMediaRef();
  assert.equal(store.injectSucceededVariants(srcA, [media]), true);
  assert.equal(store.injectSucceededVariants(srcB, [media]), true);
  assert.equal(store.injectSucceededVariants(target, [media]), true);
  const refs = store
    .nodeMap()
    [target]?.slots?.filter((slot) => slot.role === "reference_image")
    .sort((a, b) => a.order - b.order);
  const first = refs?.[0];
  const second = refs?.[1];
  assert.ok(first && second);
  assert.equal(store.connectToSlot(srcA, target, first.id).ok, true);
  assert.equal(store.connectToSlot(srcB, target, second.id).ok, true);
  const targetNode = store.nodeMap()[target];
  const sourceA = store.nodeMap()[srcA];
  const sourceB = store.nodeMap()[srcB];
  assert.ok(targetNode && sourceA && sourceB);
  targetNode.freshness = "fresh";
  sourceA.freshness = "fresh";
  sourceB.freshness = "fresh";
  assert.equal(store.reorderSlots(target, first.id, second.id), true);
  assert.equal(store.nodeMap()[target]?.freshness, "stale");
  assert.equal(store.nodeMap()[srcA]?.freshness, "fresh");
  assert.equal(store.nodeMap()[srcB]?.freshness, "fresh");
});

test("参考图、风格参考、角色参考各满 4 个，第 5 个拒绝", () => {
  const store = semanticStore();
  const id = store.addGenerationNode("reference");
  assert.ok(id);
  for (let i = 0; i < 3; i += 1) {
    assert.equal(store.addSlot(id, "reference_image").ok, true);
  }
  const refs = store.nodeMap()[id]?.slots?.filter((slot) => slot.role === "reference_image") ?? [];
  assert.equal(refs.length, 4);
  assert.equal(store.addableRoles(id).includes("reference_image"), false);
  const fifth = store.addSlot(id, "reference_image");
  assert.equal(fifth.ok, false);
  assert.equal(store.nodeMap()[id]?.slots?.filter((slot) => slot.role === "reference_image").length, 4);
  for (const role of ["style_reference", "character_reference"] as const) {
    for (let i = 0; i < 4; i += 1) {
      assert.equal(store.addSlot(id, role).ok, true);
    }
    assert.equal(store.addableRoles(id).includes(role), false);
    const extra = store.addSlot(id, role);
    assert.equal(extra.ok, false);
    assert.equal(store.nodeMap()[id]?.slots?.filter((slot) => slot.role === role).length, 4);
  }
});

test("演示3：注入 4 张假变体；抽出空白 origin=detached 条仍 4；抽回条内不 put-node", () => {
  const store = semanticStore();
  const id = store.addGenerationNode("txt2img");
  assert.ok(id);
  const media = fixtureImageMediaRef();
  assert.equal(store.injectSucceededVariants(id, [media, media, media, media]), true);
  const node = store.nodeMap()[id];
  assert.ok(node);
  assert.equal(node.versions?.[0]?.variants.length, 4);
  assert.equal(node.height, generationNodeHeight(node.slots?.length ?? 0, 4));
  const last = node.versions?.[0]?.variants[3];
  assert.ok(last);
  assert.equal(node.currentVersionId, node.versions?.[0]?.id);
  assert.equal(node.activeVariantId, last.id);
  assert.equal(node.output?.contentHash, last.output?.contentHash);
  assert.equal(node.phase, "succeeded");
  const before = Object.keys(store.nodeMap()).length;
  const extracted = store.extractVariantToBlank(id, last.id, { x: 800, y: 40 });
  assert.ok(extracted);
  const detached = store.nodeMap()[extracted];
  assert.equal(detached?.origin, "detached");
  assert.equal(detached?.output?.contentHash, last.output?.contentHash);
  assert.equal(store.nodeMap()[id]?.versions?.[0]?.variants.length, 4);
  assert.equal(store.nodeMap()[id]?.output?.contentHash, last.output?.contentHash);
  assert.equal(Object.keys(store.nodeMap()).length, before + 1);

  const dropBack = decideExtractCommit({
    dropOnSourceStrip: true,
    hitKind: "empty",
  });
  assert.equal(dropBack.action, "none");
  const dropOnBlank = decideExtractCommit({
    dropOnSourceStrip: false,
    hitKind: "empty",
  });
  assert.equal(dropOnBlank.action, "blank");
  assert.equal(Object.keys(store.nodeMap()).length, before + 1);
  assert.equal(store.nodeMap()[id]?.versions?.[0]?.variants.length, 4);
});

test("点击变体改 output 条仍 4；失败格 output=null 预览失败句", () => {
  const store = semanticStore();
  const id = store.addGenerationNode("txt2img");
  assert.ok(id);
  const media = fixtureImageMediaRef();
  store.injectSucceededVariants(id, [media, media, media, media]);
  const node = store.nodeMap()[id];
  const first = node?.versions?.[0]?.variants[0];
  const last = node?.versions?.[0]?.variants[3];
  assert.ok(first && last);
  assert.equal(store.selectActiveVariant(id, first.id), true);
  const after = store.nodeMap()[id];
  assert.equal(after?.activeVariantId, first.id);
  assert.equal(after?.output?.contentHash, first.output?.contentHash);
  assert.equal(after?.versions?.[0]?.variants.length, 4);
  assert.equal(after?.freshness, "fresh");

  const failedId = "fail-v";
  const versions = structuredClone(after?.versions ?? []);
  const current = versions[0];
  assert.ok(current);
  current.variants.push({
    id: failedId,
    index: 4,
    phase: "failed",
    seedUsed: null,
    output: null,
    text: null,
    error: null,
    createdAt: "2026-09-24T00:00:00.000Z",
  });
  after!.versions = versions;
  assert.equal(store.clickFailedVariant(id, failedId), true);
  const failedNode = store.nodeMap()[id];
  assert.equal(failedNode?.output, null);
  assert.equal(generationPreviewText(failedNode!), USER_FACING.generationFailedNoDetail);
  assert.equal(generationPreviewText(failedNode!), "生成失败，没有更多说明。");
  assert.equal(store.clickVariant(id, failedId), true);
});

test("点失败格：output 空，下游过期", () => {
  const store = semanticStore();
  const id = store.addGenerationNode("txt2img");
  const downId = store.addGenerationNode("img2img");
  assert.ok(id && downId);
  const media = fixtureImageMediaRef();
  assert.equal(store.injectSucceededVariants(id, [media]), true);
  assert.equal(store.injectSucceededVariants(downId, [media]), true);
  const sourceSlot = store.nodeMap()[downId]?.slots?.find((slot) => slot.role === "source_image");
  assert.ok(sourceSlot);
  assert.equal(store.connectToSlot(id, downId, sourceSlot.id).ok, true);
  const upstream = store.nodeMap()[id];
  assert.ok(upstream?.versions?.[0]);
  const failedId = "fail-down";
  upstream.versions[0].variants.push({
    id: failedId,
    index: 4,
    phase: "failed",
    seedUsed: 3,
    output: null,
    text: null,
    error: { code: "GENERATION_INCOMPLETE", message: "生成没有完成" },
    createdAt: "2026-09-24T00:00:00.000Z",
  });
  const down = store.nodeMap()[downId];
  assert.ok(down);
  down.freshness = "fresh";
  down.phase = "succeeded";
  assert.equal(store.clickFailedVariant(id, failedId), true);
  assert.equal(store.nodeMap()[id]?.output, null);
  assert.equal(generationPreviewText(store.nodeMap()[id]!), "生成没有完成");
  assert.equal(store.nodeMap()[downId]?.freshness, "stale");
  assert.equal(store.nodeMap()[id]?.freshness, "fresh");
});

test("setVariantCount 1..4 走独立字段并标脏", () => {
  const store = semanticStore();
  const genId = store.addGenerationNode("txt2img");
  assert.ok(genId);
  const gen = store.nodeMap()[genId]!;
  gen.phase = "succeeded";
  gen.lastSuccessFingerprint = "fp";
  gen.freshness = "fresh";
  assert.equal(store.setVariantCount(genId, 4), true);
  assert.equal(store.nodeMap()[genId]?.variantCount, 4);
  assert.equal(store.nodeMap()[genId]?.params?.variantCount, undefined);
  assert.equal(store.getSnapshot().unsaved, true);
  assert.equal(store.setVariantCount(genId, 9), true);
  assert.equal(store.nodeMap()[genId]?.variantCount, 4);
});

test("演示4：setText 下游 stale；有 prompt 边改草稿不过期", () => {
  const store = semanticStore();
  const textId = store.addTextNode();
  const genId = store.addGenerationNode("txt2img");
  assert.ok(textId && genId);
  const prompt = store.nodeMap()[genId]?.slots?.find((slot) => slot.role === "prompt");
  assert.ok(prompt);
  store.connectToSlot(textId, genId, prompt.id);
  const gen = store.nodeMap()[genId];
  assert.ok(gen);
  gen.freshness = "fresh";
  gen.lastSuccessFingerprint = "fp";
  gen.phase = "succeeded";
  gen.versions = [
    {
      id: "ver",
      createdAt: "2026-09-24T00:00:00.000Z",
      fingerprint: "fp",
      recipeId: gen.recipeId ?? "",
      recipeVersion: 1,
      paramSnapshot: {},
      variantCountRequested: 1,
      variants: [
        {
          id: "v1",
          index: 0,
          phase: "succeeded",
          seedUsed: 1,
          output: fixtureImageMediaRef(),
          text: null,
          error: null,
          createdAt: "2026-09-24T00:00:00.000Z",
        },
      ],
    },
  ];
  const fetches: string[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    fetches.push(String(input));
    return new Response(null, { status: 599 });
  }) as typeof fetch;
  try {
    store.setText(textId, "上游改过");
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(
    fetches.some((url) => url.includes("/api/execution/runs")),
    false,
  );
  assert.equal(fetches.length, 0);
  assert.equal(store.nodeMap()[textId]?.freshness ?? "fresh", "fresh");
  assert.equal(store.nodeMap()[genId]?.freshness, "stale");
  assert.equal(store.nodeMap()[genId]?.phase, "succeeded");
  assert.equal(store.getSnapshot().lastEmittedRunRequest, null);
  assert.equal(store.nodeMap()[genId]?.freshness, "stale");
  store.nodeMap()[genId]!.freshness = "fresh";
  const draft = store.setPromptDraft(genId, "草稿变了");
  assert.equal(draft.ok, true);
  assert.equal(store.nodeMap()[genId]?.freshness, "fresh");
  assert.equal(store.getSnapshot().lastEmittedRunRequest, null);
  const emitted = store.emitRunDownstream(genId);
  assert.equal(emitted.ok, true);
  if (emitted.ok) {
    assert.equal(emitted.request.scope.type, "downstream");
    assert.equal(emitted.request.force, false);
    assert.equal(store.getSnapshot().lastEmittedRunRequest?.scope.type, "downstream");
  }
});

function assertRunScope(request: RunRequest): void {
  assert.equal("originNodeIds" in request, false);
  assert.equal("originNodeIds" in request.scope, false);
  assert.equal("intent" in request, false);
  if (request.scope.type === "node") {
    assert.equal(typeof request.scope.nodeId, "string");
    assert.equal("nodeIds" in request.scope, false);
  } else if (request.scope.type === "downstream") {
    assert.equal(typeof request.scope.nodeId, "string");
    assert.equal(request.force, false);
    assert.equal("nodeIds" in request.scope, false);
  } else {
    assert.equal(request.scope.type, "selection");
    assert.equal(Array.isArray(request.scope.nodeIds), true);
    assert.equal("nodeId" in request.scope, false);
  }
}

test("三个运行按钮发出 RunScope，没有 originNodeIds 或 intent 字段", () => {
  const store = semanticStore();
  const textId = store.addTextNode();
  const genId = store.addGenerationNode("txt2img");
  assert.ok(textId && genId);
  const thisRun = store.emitRunThisNode(genId);
  assert.equal(thisRun.ok, true);
  if (thisRun.ok) {
    assert.deepEqual(thisRun.request.scope, { type: "node", nodeId: genId });
    assert.equal(thisRun.request.force, false);
    assertRunScope(thisRun.request);
  }
  const down = store.emitRunDownstream(genId);
  assert.equal(down.ok, true);
  if (down.ok) {
    assert.deepEqual(down.request.scope, { type: "downstream", nodeId: genId });
    assert.equal(down.request.force, false);
    assertRunScope(down.request);
  }
  store.select([genId]);
  const selection = store.emitRunSelection();
  assert.equal(selection.ok, true);
  if (selection.ok) {
    assert.deepEqual(selection.request.scope, { type: "selection", nodeIds: [genId] });
    assert.equal(selection.request.force, false);
    assertRunScope(selection.request);
  }
  const textRun = store.emitRunThisNode(textId);
  assert.equal(textRun.ok, false);
});

test("未接入能力点击主句；不建节点", () => {
  const store = semanticStore();
  const clicked = unimplementedCapabilityClick();
  assert.equal(clicked.message, "这一类还没接入。");
  assert.equal(clicked.message, USER_FACING.notImplemented);
  assert.equal(clicked.message, COPY.notImplemented);
  assert.equal(clicked.added, false);
  const before = Object.keys(store.nodeMap()).length;
  assert.equal(store.addGenerationNode("complete"), null);
  assert.equal(store.addGenerationNode("txt2video"), null);
  assert.equal(store.addGenerationNode("talking-head"), null);
  assert.equal(Object.keys(store.nodeMap()).length, before);
  assert.equal(store.getSnapshot().lastEmittedRunRequest, null);
  const implemented = store.addGenerationNode("txt2img");
  assert.ok(implemented);
  assert.equal(Object.keys(store.nodeMap()).length, before + 1);
});

test("创建图生视频默认夹具；检查器可换成缺密钥桩，不把 adapterId 当配方 id", () => {
  const store = semanticStore();
  const id = store.addGenerationNode("img2video");
  assert.ok(id);
  const node = store.nodeMap()[id!];
  assert.equal(node?.recipeId, "recipe.video.img2video.fixture");
  assert.notEqual(node?.recipeId, "example.video.fixture");
  assert.equal(node?.outputKind, "video");
  assert.equal(node?.kind, "generation");
  assert.equal(node?.params?.durationSeconds, "4");
  assert.equal(typeof node?.params?.durationSeconds, "string");
  assert.equal(node?.secretRef ?? null, null);
  assert.deepEqual(
    (node?.slots ?? []).map((slot) => slot.role),
    ["first_frame"],
  );
  assert.equal(store.setGenerationRecipe(id!, "recipe.video.img2video.needs-secret"), true);
  const swapped = store.nodeMap()[id!];
  assert.equal(swapped?.recipeId, "recipe.video.img2video.needs-secret");
  assert.equal(swapped?.secretRef?.providerId, "example.cloud");
  assert.notEqual(swapped?.recipeId, "example.video.needs-secret");
});

test("阶段 4 主句来自 USER_FACING；交给本机队列不是正在安排", () => {
  assert.equal(COPY.handingToLocalQueue, "正在交给本机队列");
  assert.equal(COPY.handingToLocalQueue, USER_FACING.handingToLocalQueue);
  assert.equal(COPY.handingToLocalQueue.includes("正在安排"), false);
  assert.equal(COPY.localQueueAhead(1), "前面还有 1 个本地任务");
  assert.equal(COPY.localQueueAhead(1).includes("%"), false);
  assert.equal(COPY.generatingElapsed("12秒"), "正在生成，已用时12秒");
  assert.equal(COPY.generatingElapsed("12秒").includes("%"), false);
  assert.equal(COPY.cancelling, "正在取消");
  assert.equal(COPY.cancelledNoResult, "已取消，没有新结果");
  assert.equal(COPY.tooLateToCancel, "来不及取消，结果已经完成");
  assert.equal(COPY.cancelUncertain, "取消结果不确定");
  assert.equal(COPY.comfyUnconfigured, "还没有填写本机 ComfyUI 地址。");
  assert.equal(COPY.ingestSvg, "第一版不接收 SVG。");
});

test("applyNodePatch 忽略坐标；入队不脏；落地重算 height；Ctrl+Z 不撤图", () => {
  const store = storeWithEmpty();
  const genId = store.addGenerationNode("txt2img");
  assert.ok(genId);
  const textId = store.addTextNode();
  assert.ok(textId);
  store.setText(textId, "占一步");
  const gen = store.nodeMap()[genId];
  assert.ok(gen);
  const startX = gen.x;
  const startY = gen.y;
  const rev = store.getSnapshot().project?.contentRevision ?? 0;
  store.acknowledgeWorkingCopy(rev, store.syncGeneration());
  store.markSaved(rev, rev);
  assert.equal(store.getSnapshot().unsaved, false);
  assert.equal(store.getSnapshot().needsWorkingCopySync, false);
  store.applyNodePatch(genId, {
    phase: "queued",
    lastRunId: "run-1",
    lastTaskId: "task-1",
    lastAttemptFingerprint: "fp",
    progress: { ratio: null, label: USER_FACING.handingToLocalQueue },
    x: startX + 80,
    y: startY + 40,
  });
  const queued = store.nodeMap()[genId];
  assert.ok(queued);
  assert.equal(queued.x, startX);
  assert.equal(queued.y, startY);
  assert.equal(queued.phase, "queued");
  assert.equal(store.getSnapshot().unsaved, false);
  assert.equal(store.getSnapshot().needsWorkingCopySync, false);
  const media = fixtureImageMediaRef();
  store.applyNodePatch(
    genId,
    {
      phase: "succeeded",
      versions: [
        {
          id: "ver",
          createdAt: "2026-09-24T00:00:00.000Z",
          fingerprint: "fp",
          recipeId: queued.recipeId ?? "",
          recipeVersion: 1,
          paramSnapshot: {},
          variantCountRequested: 1,
          variants: [
            {
              id: "v1",
              index: 0,
              phase: "succeeded",
              seedUsed: 1,
              output: media,
              text: null,
              error: null,
              createdAt: "2026-09-24T00:00:00.000Z",
            },
          ],
        },
      ],
      currentVersionId: "ver",
      activeVariantId: "v1",
      output: media,
    },
    { contentRevision: 2, executionRevision: 2 },
  );
  const landed = store.nodeMap()[genId];
  assert.ok(landed);
  assert.equal(landed.output?.contentHash, media.contentHash);
  assert.equal(landed.height, generationNodeHeight(landed.slots?.length ?? 0, 1));
  assert.equal(store.getSnapshot().unsaved, true);
  store.undo();
  assert.equal(store.nodeMap()[genId]?.output?.contentHash, media.contentHash);
  assert.equal(store.nodeMap()[textId]?.text ?? "", "");
});

test("move 手势期间 patch 排队，pointerup flush 即使位移 0", () => {
  const store = storeWithEmpty();
  const genId = store.addGenerationNode("txt2img");
  assert.ok(genId);
  store.setGestureActive(true, "move");
  store.applyNodePatch(genId, { phase: "queued", lastTaskId: "t1" });
  assert.equal(store.nodeMap()[genId]?.phase ?? "idle", "idle");
  store.setGestureActive(false);
  assert.equal(store.nodeMap()[genId]?.phase, "queued");
  store.setGestureActive(true, "pan");
  store.applyNodePatch(genId, { phase: "running" });
  assert.equal(store.nodeMap()[genId]?.phase, "running");
});

test("absorb 保留客户端坐标与正文，合入执行字段", () => {
  const store = storeWithEmpty();
  const textId = store.addTextNode();
  const genId = store.addGenerationNode("txt2img");
  assert.ok(textId && genId);
  store.setText(textId, "一只纸船");
  const local = store.nodeMap()[genId];
  assert.ok(local);
  const server = structuredClone(store.getSnapshot().project);
  assert.ok(server);
  server.contentRevision = 9;
  const remoteGen = server.nodes[genId];
  assert.ok(remoteGen);
  remoteGen.phase = "queued";
  remoteGen.lastRunId = "run-x";
  remoteGen.x = local.x + 50;
  const remoteText = server.nodes[textId];
  assert.ok(remoteText);
  remoteText.text = "服务器旧字";
  store.absorbServerFields(server);
  assert.equal(store.nodeMap()[genId]?.phase, "queued");
  assert.equal(store.nodeMap()[genId]?.lastRunId, "run-x");
  assert.equal(store.nodeMap()[genId]?.x, local.x);
  assert.equal(store.nodeMap()[textId]?.text, "一只纸船");
  assert.equal(store.getSnapshot().project?.contentRevision, 9);
});

test("addImportedImage 入历史并标脏；origin imported", () => {
  const store = storeWithEmpty();
  const id = store.addImportedImage(fixtureImageMediaRef(), { x: 10, y: 20 });
  assert.ok(id);
  const node = store.nodeMap()[id];
  assert.ok(node);
  assert.equal(node.kind, "image");
  assert.equal(node.origin, "imported");
  assert.equal(store.getSnapshot().unsaved, true);
  assert.equal(store.getSnapshot().needsWorkingCopySync, true);
  store.undo();
  assert.equal(store.nodeMap()[id], undefined);
});

test("addImportedAudio 选中并标脏；接到参考图槽回弹且不产生边", () => {
  const store = storeWithEmpty();
  const media = {
    ...fixtureImageMediaRef(),
    kind: "audio" as const,
    mimeDetected: "audio/wav",
    width: null,
    height: null,
    durationMs: null,
    thumbRelativePath: null,
    coverRelativePath: null,
    proxyRelativePath: null,
  };
  const audioId = store.addImportedAudio(media, { x: 10, y: 20 });
  assert.ok(audioId);
  const audio = store.nodeMap()[audioId];
  assert.ok(audio);
  assert.equal(audio.kind, "audio");
  assert.equal(audio.origin, "imported");
  assert.equal(audio.output?.kind, "audio");
  assert.equal(audio.output?.durationMs, null);
  assert.deepEqual(store.getSnapshot().selectedIds, [audioId]);
  assert.equal(store.getSnapshot().needsWorkingCopySync, true);
  const refId = store.addGenerationNode("reference");
  assert.ok(refId);
  const refSlot = store.nodeMap()[refId]?.slots?.find((slot) => slot.role === "reference_image");
  assert.ok(refSlot);
  const edgesBefore = Object.keys(store.edgeMap()).length;
  const bounced = store.connectToSlot(audioId, refId, refSlot.id);
  assert.equal(bounced.ok, false);
  if (!bounced.ok) {
    assert.equal(bounced.message, USER_FACING.audioToReferenceImage);
    assert.equal(bounced.message.includes("音频参考"), true);
    assert.equal(bounced.message.includes("参考图"), true);
  }
  assert.equal(Object.keys(store.edgeMap()).length, edgesBefore);
  const prompt = store.nodeMap()[refId]?.slots?.find((slot) => slot.role === "prompt");
  assert.ok(prompt);
  const other = store.connectToSlot(audioId, refId, prompt.id);
  assert.equal(other.ok, false);
  if (!other.ok) {
    assert.equal(other.message, USER_FACING.kindMismatch("音频", "提示词"));
    assert.equal(other.message.includes("音频参考"), false);
  }
});

test("切换版本看见版本 2 / 共 N，写高度，只标下游，周围坐标不动，不发运行", () => {
  const store = semanticStore();
  const id = store.addGenerationNode("txt2img");
  const textId = store.addTextNode();
  const downId = store.addGenerationNode("img2img");
  assert.ok(id && textId && downId);
  const media = fixtureImageMediaRef();
  assert.equal(store.injectSucceededVariants(id, [media]), true);
  assert.equal(store.injectSucceededVariants(id, [media, media, media, media]), true);
  const node = store.nodeMap()[id];
  assert.ok(node?.versions && node.versions.length === 2);
  const first = node.versions[0];
  const second = node.versions[1];
  assert.ok(first && second);
  first.variants = [];
  first.fingerprint = "does-not-match";
  const versionsBefore = JSON.stringify(node.versions);
  const phaseBefore = node.phase;
  const successFp = node.lastSuccessFingerprint;
  const neighbor = store.nodeMap()[textId];
  assert.ok(neighbor);
  const neighborX = neighbor.x;
  const neighborY = neighbor.y;
  const slot = store.nodeMap()[downId]?.slots?.find((item) => item.role === "source_image");
  assert.ok(slot);
  assert.equal(store.connectToSlot(id, downId, slot.id).ok, true);
  const downstream = store.nodeMap()[downId];
  assert.ok(downstream);
  downstream.freshness = "fresh";
  const revision = store.getSnapshot().project?.contentRevision ?? 0;
  store.markSaved(revision, revision);
  assert.equal(store.getSnapshot().unsaved, false);
  assert.equal(store.selectVersion(id, first.id), true);
  const after = store.nodeMap()[id];
  assert.ok(after);
  assert.equal(versionLabel(after), "版本 1 / 共 2");
  assert.equal(after.currentVersionId, first.id);
  assert.equal(after.height, generationNodeHeight(after.slots?.length ?? 0, 0));
  assert.notEqual(after.height, generationNodeHeight(after.slots?.length ?? 0, 4));
  assert.equal(after.phase, phaseBefore);
  assert.equal(after.lastSuccessFingerprint, successFp);
  assert.equal(JSON.stringify(after.versions), versionsBefore);
  assert.equal(after.freshness, "stale");
  assert.equal(store.nodeMap()[downId]?.freshness, "stale");
  assert.equal(store.nodeMap()[textId]?.x, neighborX);
  assert.equal(store.nodeMap()[textId]?.y, neighborY);
  assert.equal(store.getSnapshot().lastEmittedRunRequest, null);
  assert.equal(store.getSnapshot().unsaved, true);
  assert.equal(store.selectVersion(id, second.id), true);
  assert.equal(versionLabel(store.nodeMap()[id] ?? after), "版本 2 / 共 2");
  const back = store.nodeMap()[id];
  assert.ok(back);
  back.phase = "queued";
  const kept = back.currentVersionId;
  assert.equal(store.selectVersion(id, first.id), false);
  assert.equal(store.nodeMap()[id]?.currentVersionId, kept);
});

test("reorderSlots 只对调两个同角色槽；自己、缺槽、角色不同不产生命令；边 id 仍记在 targetSlotId", () => {
  const store = semanticStore();
  const id = store.addGenerationNode("reference");
  const textId = store.addTextNode();
  const srcA = store.addGenerationNode("txt2img");
  assert.ok(id && textId && srcA);
  assert.equal(store.addSlot(id, "reference_image").ok, true);
  assert.equal(store.addSlot(id, "reference_image").ok, true);
  assert.equal(store.injectSucceededVariants(srcA, [fixtureImageMediaRef()]), true);
  const slots = store.nodeMap()[id]?.slots ?? [];
  const prompt = slots.find((slot) => slot.role === "prompt");
  const refs = slots.filter((slot) => slot.role === "reference_image").sort((a, b) => a.order - b.order);
  const first = refs[0];
  const second = refs[1];
  const third = refs[2];
  assert.ok(prompt && first && second && third);
  assert.equal(store.connectToSlot(textId, id, prompt.id).ok, true);
  assert.equal(store.connectToSlot(srcA, id, second.id).ok, true);
  const promptEdge = Object.values(store.edgeMap()).find((edge) => edge.targetSlotId === prompt.id);
  const refEdge = Object.values(store.edgeMap()).find((edge) => edge.targetSlotId === second.id);
  assert.ok(promptEdge && refEdge);
  const before = structuredClone(store.nodeMap()[id]?.slots);
  assert.equal(store.reorderSlots(id, first.id, first.id), false);
  assert.equal(store.reorderSlots(id, first.id, prompt.id), false);
  assert.equal(store.reorderSlots(id, "missing", second.id), false);
  assert.deepEqual(store.nodeMap()[id]?.slots, before);
  assert.equal(store.edgeMap()[promptEdge.id]?.id, promptEdge.id);
  assert.equal(store.edgeMap()[refEdge.id]?.targetSlotId, second.id);
  const promptOrder = prompt.order;
  const thirdOrder = third.order;
  assert.equal(store.reorderSlots(id, first.id, second.id), true);
  const after = store.nodeMap()[id]?.slots ?? [];
  assert.equal(after.find((slot) => slot.id === prompt.id)?.order, promptOrder);
  assert.equal(after.find((slot) => slot.id === third.id)?.order, thirdOrder);
  assert.equal(after.find((slot) => slot.id === second.id)?.order, first.order);
  assert.equal(after.find((slot) => slot.id === first.id)?.order, second.order);
  assert.equal(store.edgeMap()[refEdge.id]?.id, refEdge.id);
  assert.equal(store.edgeMap()[refEdge.id]?.targetSlotId, second.id);
  assert.equal(after.find((slot) => slot.id === second.id)?.edgeId, refEdge.id);
  assert.equal(store.edgeMap()[promptEdge.id]?.targetSlotId, prompt.id);
  const body = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "EditorStore.ts"), "utf8");
  const reorderAt = body.indexOf("reorderSlots(nodeId");
  const fn = body.slice(reorderAt, body.indexOf("selectActiveVariant(", reorderAt));
  assert.equal(fn.includes("order: to.order"), true);
  assert.equal(fn.includes("order: from.order"), true);
  assert.equal(fn.includes("reindexSlots"), true);
  assert.equal(fn.includes("splice"), false);
});

test("只选中边时删除是断开连线；框选不选边；重做清空选择", () => {
  const store = semanticStore();
  const textId = store.addTextNode();
  const genId = store.addGenerationNode("txt2img");
  assert.ok(textId && genId);
  const prompt = store.nodeMap()[genId]?.slots?.find((slot) => slot.role === "prompt");
  assert.ok(prompt);
  assert.equal(store.connectToSlot(textId, genId, prompt.id).ok, true);
  const edge = Object.values(store.edgeMap())[0];
  assert.ok(edge);
  store.select([textId]);
  store.select([textId], [edge.id]);
  assert.deepEqual(store.getSnapshot().selectedIds, [textId]);
  assert.deepEqual(store.getSnapshot().selectedEdgeIds, [edge.id]);
  store.select([], [edge.id]);
  assert.deepEqual(store.getSnapshot().selectedIds, []);
  assert.deepEqual(store.getSnapshot().selectedEdgeIds, [edge.id]);
  store.marqueeSelect([genId], false);
  assert.deepEqual(store.getSnapshot().selectedEdgeIds, []);
  assert.deepEqual(store.getSnapshot().selectedIds, [genId]);
  store.select([], [edge.id]);
  store.deleteSelection();
  assert.equal(store.edgeMap()[edge.id], undefined);
  assert.equal(store.nodeMap()[genId]?.slots?.find((slot) => slot.id === prompt.id)?.edgeId, null);
  assert.ok(store.nodeMap()[textId]);
  assert.ok(store.nodeMap()[genId]);
  assert.deepEqual(store.getSnapshot().selectedIds, []);
  assert.deepEqual(store.getSnapshot().selectedEdgeIds, []);
  assert.equal(store.undo(), true);
  assert.equal(store.edgeMap()[edge.id]?.targetSlotId, prompt.id);
  assert.equal(store.nodeMap()[genId]?.slots?.find((slot) => slot.id === prompt.id)?.edgeId, edge.id);
  assert.equal(store.redo(), true);
  assert.equal(store.edgeMap()[edge.id], undefined);
  assert.deepEqual(store.getSnapshot().selectedIds, []);
  assert.deepEqual(store.getSnapshot().selectedEdgeIds, []);
  const body = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "EditorStore.ts"), "utf8");
  const deleteAt = body.indexOf("deleteSelection(): void");
  const fn = body.slice(deleteAt, body.indexOf("connect(sourceNodeId", deleteAt));
  assert.equal(fn.includes("断开连线"), true);
  assert.equal(fn.includes("删除 ${nodeCount} 个节点"), true);
  assert.equal(fn.includes("要连到槽上，已取消"), false);
});

test("Alt 复制并移动是一条命令；位移 0 或取消则复制不留；外延边不复制", () => {
  const store = semanticStore();
  const textId = store.addTextNode();
  const genId = store.addGenerationNode("txt2img");
  assert.ok(textId && genId);
  const prompt = store.nodeMap()[genId]?.slots?.find((slot) => slot.role === "prompt");
  assert.ok(prompt);
  assert.equal(store.connectToSlot(textId, genId, prompt.id).ok, true);
  const originX = store.nodeMap()[textId]?.x;
  store.select([textId]);
  const onlyText = store.stageAltDuplicate();
  assert.equal(onlyText.length, 1);
  assert.equal(Object.keys(store.edgeMap()).length, 1);
  store.discardAltStage();
  assert.equal(store.nodeMap()[onlyText[0] ?? ""], undefined);
  assert.deepEqual(store.getSnapshot().selectedIds, [textId]);

  store.select([textId, genId]);
  const copied = store.stageAltDuplicate();
  assert.equal(copied.length, 2);
  assert.equal(Object.keys(store.edgeMap()).length, 2);
  assert.equal(store.nodeMap()[textId]?.x, originX);
  assert.equal(store.commitAltMove(0, 0), false);
  assert.equal(store.nodeMap()[copied[0] ?? ""], undefined);
  assert.equal(Object.keys(store.edgeMap()).length, 1);
  assert.equal(store.getSnapshot().canUndo, true);

  store.select([textId, genId]);
  const again = store.stageAltDuplicate();
  assert.equal(again.length, 2);
  const undoBefore = store.getSnapshot().canUndo;
  assert.equal(store.commitAltMove(15, 0), true);
  assert.equal(store.nodeMap()[textId]?.x, originX);
  const moved = again.map((id) => store.nodeMap()[id]).find((node) => node?.kind === "text");
  assert.equal(moved?.x, (originX ?? 0) + 15);
  assert.equal(store.getSnapshot().canUndo, true);
  assert.equal(undoBefore, true);
  store.undo();
  assert.equal(store.nodeMap()[again[0] ?? ""], undefined);
  assert.equal(store.nodeMap()[textId]?.x, originX);
  assert.equal(Object.keys(store.edgeMap()).length, 1);
});

test("粘贴文本落在给定点；过长不建节点；一批导入错开 24 且一次撤销", () => {
  const store = semanticStore();
  assert.equal(store.addTextAt("x".repeat(TEXT_MAX_CHARS + 1), { x: 0, y: 0 }), null);
  assert.equal(store.addTextAt("", { x: 0, y: 0 }), null);
  const id = store.addTextAt("你好", { x: 100, y: 80 });
  assert.ok(id);
  const node = store.nodeMap()[id];
  assert.equal(node?.text, "你好");
  assert.equal(node?.x, 100 - 280 / 2);
  assert.equal(node?.y, 80 - 180 / 2);
  const media = fixtureImageMediaRef();
  const ids = store.addImportedBatch([
    { media, world: { x: 10, y: 20 } },
    { media, world: { x: 10 + COPY_OFFSET, y: 20 + COPY_OFFSET } },
  ]);
  assert.equal(ids.length, 2);
  assert.equal(store.nodeMap()[ids[1] ?? ""]?.x, store.nodeMap()[ids[0] ?? ""]!.x + COPY_OFFSET);
  store.undo();
  assert.equal(store.nodeMap()[ids[0] ?? ""], undefined);
  assert.equal(store.nodeMap()[ids[1] ?? ""], undefined);
  assert.equal(store.nodeMap()[id]?.text, "你好");
});

test("断开槽只去掉边；芯片挪到空槽或占用槽是一条命令，不兼容则不动", () => {
  const store = semanticStore();
  const textId = store.addTextNode();
  const genId = store.addGenerationNode("reference");
  const otherId = store.addGenerationNode("txt2img");
  assert.ok(textId && genId && otherId);
  assert.equal(store.addSlot(genId, "reference_image").ok, true);
  const slots = store.nodeMap()[genId]?.slots ?? [];
  const prompt = slots.find((slot) => slot.role === "prompt");
  const refs = slots.filter((slot) => slot.role === "reference_image").sort((a, b) => a.order - b.order);
  const first = refs[0];
  const second = refs[1];
  assert.ok(prompt && first && second);
  assert.equal(store.connectToSlot(textId, genId, prompt.id).ok, true);
  const edge = Object.values(store.edgeMap()).find((item) => item.targetSlotId === prompt.id);
  assert.ok(edge);
  assert.equal(store.disconnectSlot(genId, prompt.id), true);
  assert.equal(store.edgeMap()[edge.id], undefined);
  assert.equal(store.nodeMap()[genId]?.slots?.find((slot) => slot.id === prompt.id)?.edgeId, null);
  assert.equal(store.nodeMap()[genId]?.slots?.some((slot) => slot.id === prompt.id), true);
  store.undo();
  assert.equal(store.edgeMap()[edge.id]?.targetSlotId, prompt.id);

  assert.equal(store.injectSucceededVariants(otherId, [fixtureImageMediaRef()]), true);
  assert.equal(store.connectToSlot(otherId, genId, first.id).ok, true);
  const imageEdge = Object.values(store.edgeMap()).find((item) => item.targetSlotId === first.id);
  assert.ok(imageEdge);
  assert.equal(store.relocateSlotEdge(genId, first.id, genId, second.id).ok, true);
  assert.equal(store.edgeMap()[imageEdge.id]?.id, imageEdge.id);
  assert.equal(store.edgeMap()[imageEdge.id]?.targetSlotId, second.id);
  assert.equal(store.nodeMap()[genId]?.slots?.find((slot) => slot.id === first.id)?.edgeId, null);
  assert.equal(store.nodeMap()[genId]?.slots?.find((slot) => slot.id === second.id)?.edgeId, imageEdge.id);
  store.undo();
  assert.equal(store.edgeMap()[imageEdge.id]?.targetSlotId, first.id);

  const thirdId = store.addGenerationNode("txt2img");
  assert.ok(thirdId);
  assert.equal(store.injectSucceededVariants(thirdId, [fixtureImageMediaRef()]), true);
  assert.equal(store.connectToSlot(thirdId, genId, second.id).ok, true);
  const occupied = Object.values(store.edgeMap()).find((item) => item.targetSlotId === second.id);
  assert.ok(occupied);
  const replaced = store.relocateSlotEdge(genId, first.id, genId, second.id);
  assert.equal(replaced.ok, true);
  if (replaced.ok) {
    assert.equal(replaced.replace, true);
  }
  assert.equal(store.edgeMap()[occupied.id], undefined);
  assert.equal(store.edgeMap()[imageEdge.id]?.targetSlotId, second.id);
  assert.equal(store.nodeMap()[genId]?.slots?.find((slot) => slot.id === first.id)?.edgeId, null);
  store.undo();
  assert.equal(store.edgeMap()[occupied.id]?.targetSlotId, second.id);
  assert.equal(store.edgeMap()[imageEdge.id]?.targetSlotId, first.id);

  assert.equal(store.connectToSlot(textId, genId, prompt.id).ok, true);
  const before = Object.keys(store.edgeMap()).length;
  const mismatch = store.relocateSlotEdge(genId, prompt.id, genId, second.id);
  assert.equal(mismatch.ok, false);
  assert.equal(Object.keys(store.edgeMap()).length, before);
  assert.equal(store.edgeMap()[imageEdge.id]?.targetSlotId, first.id);
  assert.equal(store.nodeMap()[genId]?.slots?.find((slot) => slot.id === prompt.id)?.edgeId !== null, true);
});



