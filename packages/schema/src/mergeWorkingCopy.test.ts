import assert from "node:assert/strict";
import { test } from "node:test";
import { RECIPE_TXT2IMG } from "./capabilities.ts";
import { createEmptyProject } from "./createEmptyProject.ts";
import { fingerprintNode } from "./fingerprint.ts";
import { mergeWorkingCopy } from "./mergeWorkingCopy.ts";
import type {
  CanvasProjectFile,
  MediaRef,
  ProjectEdge,
  ProjectNode,
  ResultVersion,
} from "./types.ts";
import { RANDOM_SEED } from "./types.ts";
import { USER_FACING } from "./userFacingMessages.ts";

const NOW = new Date("2026-09-24T12:00:00.000Z");

function mediaRef(relativePath: string): MediaRef {
  return {
    kind: "image",
    relativePath,
    contentHash: "ab".repeat(32),
    byteSize: 12,
    mimeDetected: "image/png",
    width: 8,
    height: 8,
    durationMs: null,
    firstFrameRelativePath: null,
    lastFrameRelativePath: null,
    coverRelativePath: null,
    proxyRelativePath: null,
    thumbRelativePath: null,
  };
}

function versionKeep(): ResultVersion {
  return {
    id: "ver-keep",
    createdAt: "2026-09-24T00:00:00.000Z",
    fingerprint: "fp-keep",
    recipeId: "recipe.keep",
    recipeVersion: 1,
    paramSnapshot: {},
    variantCountRequested: 1,
    variants: [
      {
        id: "var-keep",
        index: 0,
        phase: "succeeded",
        seedUsed: 1,
        output: mediaRef("media/blobs/ab/ab.blob"),
        text: null,
        error: null,
        createdAt: "2026-09-24T00:00:00.000Z",
      },
    ],
  };
}

function baseNode(overrides: Partial<ProjectNode> & { id: string }): ProjectNode {
  const node: ProjectNode = {
    id: overrides.id,
    kind: "text",
    title: "文本 1",
    x: 10,
    y: 20,
    width: 280,
    height: 180,
    z: 1,
    groupId: null,
    origin: "authored",
    createdAt: "2026-09-24T00:00:00.000Z",
    updatedAt: "2026-09-24T00:00:00.000Z",
    outputRevision: 3,
    text: "一只纸船",
    phase: "idle",
    freshness: "fresh",
    inputsChangedWhileRunning: true,
    lastSuccessFingerprint: "fp-success",
    lastAttemptFingerprint: "fp-attempt",
    lastError: { code: "GEN", message: "生成失败，没有更多说明。" },
    runner: "local",
    progress: { ratio: 0.25, label: "排队" },
    versions: [versionKeep()],
    currentVersionId: "ver-keep",
    activeVariantId: "var-keep",
    output: mediaRef("media/blobs/ab/ab.blob"),
    outputText: null,
    lastRunId: "run-1",
    lastTaskId: "task-1",
    executionRevision: 7,
  };
  return { ...node, ...overrides };
}

function projectWith(node: ProjectNode, contentRevision = 4): CanvasProjectFile {
  const project = createEmptyProject({
    projectId: "proj-merge",
    name: "合并",
    now: NOW,
  });
  project.contentRevision = contentRevision;
  project.savedContentRevision = 0;
  project.nodes[node.id] = node;
  return project;
}

test("phase=queued 时客户端 PUT idle 或省略 phase，合并后仍为 queued，且不覆盖服务器权威字段", () => {
  const serverNode = baseNode({ id: "n1", phase: "queued" });
  const server = projectWith(serverNode);
  const snapshot = structuredClone(server);

  const idlePut = mergeWorkingCopy(
    server,
    {
      contentRevision: 4,
      nodes: {
        n1: baseNode({
          id: "n1",
          phase: "idle",
          x: 99,
          y: 88,
          width: 300,
          height: 200,
          z: 9,
          title: "改过的标题",
          text: "新正文",
          progress: null,
          versions: [],
          lastSuccessFingerprint: null,
          lastAttemptFingerprint: null,
          lastError: null,
          runner: null,
          lastRunId: "hack-run",
          lastTaskId: "hack-task",
          inputsChangedWhileRunning: false,
          executionRevision: 0,
        }),
      },
      edges: {},
      groups: {},
    },
    { now: NOW },
  );
  assert.equal(idlePut.ok, true);
  if (!idlePut.ok) {
    return;
  }
  const queued = idlePut.project.nodes.n1;
  assert.ok(queued);
  assert.equal(queued.phase, "queued");
  assert.deepEqual(queued.progress, { ratio: 0.25, label: "排队" });
  assert.equal(queued.versions?.[0]?.id, "ver-keep");
  assert.equal(queued.lastSuccessFingerprint, "fp-success");
  assert.equal(queued.lastAttemptFingerprint, "fp-attempt");
  assert.deepEqual(queued.lastError, {
    code: "GEN",
    message: "生成失败，没有更多说明。",
  });
  assert.equal(queued.runner, "local");
  assert.equal(queued.lastRunId, "run-1");
  assert.equal(queued.lastTaskId, "task-1");
  assert.equal(queued.inputsChangedWhileRunning, true);
  assert.equal(queued.executionRevision, 7);
  assert.equal(queued.x, 99);
  assert.equal(queued.y, 88);
  assert.equal(queued.width, 300);
  assert.equal(queued.height, 200);
  assert.equal(queued.z, 9);
  assert.equal(queued.title, "改过的标题");
  assert.equal(queued.text, "新正文");
  assert.deepEqual(server, snapshot);

  const omitPhaseNode = baseNode({ id: "n1", x: 1, y: 2, text: "省略相位" });
  delete omitPhaseNode.phase;
  const omitted = mergeWorkingCopy(server, {
    contentRevision: 4,
    nodes: { n1: omitPhaseNode },
    edges: {},
    groups: {},
  });
  assert.equal(omitted.ok, true);
  if (omitted.ok) {
    assert.equal(omitted.project.nodes.n1?.phase, "queued");
    assert.equal(omitted.project.nodes.n1?.text, "省略相位");
    assert.equal(omitted.project.nodes.n1?.x, 1);
    assert.equal(omitted.project.nodes.n1?.y, 2);
  }
});

test("queued 或 running 时客户端不得覆盖变体指针；idle 时可以", () => {
  for (const phase of ["queued", "running"] as const) {
    const server = projectWith(baseNode({ id: "n1", phase }));
    const result = mergeWorkingCopy(server, {
      contentRevision: 4,
      nodes: {
        n1: baseNode({
          id: "n1",
          phase: "idle",
          currentVersionId: "hack-ver",
          activeVariantId: "hack-var",
          output: mediaRef("media/blobs/cd/cd.blob"),
          outputText: "hack-text",
          outputRevision: 99,
          freshness: "stale",
          x: 50,
        }),
      },
      edges: {},
      groups: {},
    });
    assert.equal(result.ok, true, phase);
    if (result.ok) {
      const node = result.project.nodes.n1;
      assert.ok(node);
      assert.equal(node.phase, phase);
      assert.equal(node.currentVersionId, "ver-keep");
      assert.equal(node.activeVariantId, "var-keep");
      assert.equal(node.output?.relativePath, "media/blobs/ab/ab.blob");
      assert.equal(node.outputText, null);
      assert.equal(node.outputRevision, 3);
      assert.equal(node.freshness, "fresh");
      assert.equal(node.x, 50);
    }
  }

  const idleServer = projectWith(baseNode({ id: "n1", phase: "idle" }));
  const idleMerged = mergeWorkingCopy(idleServer, {
    contentRevision: 4,
    nodes: {
      n1: baseNode({
        id: "n1",
        phase: "idle",
        currentVersionId: "ver-2",
        activeVariantId: "var-2",
        output: null,
        outputText: "对外正文",
        outputRevision: 4,
        freshness: "stale",
      }),
    },
    edges: {},
    groups: {},
  });
  assert.equal(idleMerged.ok, true);
  if (idleMerged.ok) {
    const node = idleMerged.project.nodes.n1;
    assert.ok(node);
    assert.equal(node.currentVersionId, "ver-2");
    assert.equal(node.activeVariantId, "var-2");
    assert.equal(node.output, null);
    assert.equal(node.outputText, "对外正文");
    assert.equal(node.outputRevision, 4);
    assert.equal(node.freshness, "stale");
  }
});

test("contentRevision 不等则 409 不应用合并", () => {
  const server = projectWith(baseNode({ id: "n1", phase: "queued" }));
  const snapshot = structuredClone(server);
  const result = mergeWorkingCopy(server, {
    contentRevision: 3,
    nodes: {
      n1: baseNode({ id: "n1", phase: "idle", text: "不该写进去" }),
    },
    edges: {},
    groups: {},
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.httpStatus, 409);
    assert.equal(result.message, USER_FACING.workingCopySyncFailed);
  }
  assert.deepEqual(server, snapshot);
});

test("working-copy PUT 含密钥键或超长文本则拒绝，不应用合并", () => {
  const server = projectWith(baseNode({ id: "n1", phase: "queued" }));
  const snapshot = structuredClone(server);
  const withKey = mergeWorkingCopy(server, {
    contentRevision: 4,
    nodes: { n1: baseNode({ id: "n1", text: "还在" }) },
    edges: {},
    groups: {},
    apiKey: "x",
  });
  assert.equal(withKey.ok, false);
  if (!withKey.ok) {
    assert.equal(withKey.httpStatus, 400);
    assert.equal(withKey.code, "forbidden_key");
  }
  assert.deepEqual(server, snapshot);

  const tooLong = mergeWorkingCopy(server, {
    contentRevision: 4,
    nodes: { n1: baseNode({ id: "n1", text: "汉".repeat(100001) }) },
    edges: {},
    groups: {},
  });
  assert.equal(tooLong.ok, false);
  if (!tooLong.ok) {
    assert.equal(tooLong.httpStatus, 400);
    assert.equal(tooLong.message, "文本太长，没有放进节点。");
  }
  assert.deepEqual(server, snapshot);
});

test("新节点即使带 phase=queued 也落到 idle，不把客户端执行字段当真", () => {
  const server = createEmptyProject({ projectId: "p", name: "n", now: NOW });
  const result = mergeWorkingCopy(server, {
    contentRevision: 0,
    nodes: {
      n2: baseNode({
        id: "n2",
        phase: "queued",
        lastRunId: "client-run",
        executionRevision: 9,
        text: "新节点",
      }),
    },
    edges: {},
    groups: {},
  });
  assert.equal(result.ok, true);
  if (result.ok) {
    const node = result.project.nodes.n2;
    assert.ok(node);
    assert.equal(node.phase, "idle");
    assert.equal(node.lastRunId, null);
    assert.equal(node.executionRevision, 0);
    assert.equal(node.text, "新节点");
    assert.equal(result.project.contentRevision, 1);
  }
});

function generationNode(overrides: Partial<ProjectNode> = {}): ProjectNode {
  return {
    id: "g",
    kind: "generation",
    title: "文生图",
    x: 400,
    y: 0,
    width: 320,
    height: 240,
    z: 2,
    groupId: null,
    origin: "authored",
    createdAt: "2026-09-24T00:00:00.000Z",
    updatedAt: "2026-09-24T00:00:00.000Z",
    outputRevision: 1,
    promptDraft: "草稿",
    recipeId: RECIPE_TXT2IMG,
    recipeVersion: 1,
    params: { seed: RANDOM_SEED },
    variantCount: 1,
    slots: [{ id: "p", role: "prompt", order: 0, edgeId: "e1" }],
    phase: "queued",
    freshness: "fresh",
    inputsChangedWhileRunning: false,
    lastAttemptFingerprint: null,
    lastSuccessFingerprint: null,
    lastError: null,
    runner: "local",
    versions: [],
    executionRevision: 1,
    ...overrides,
  };
}

function connectedText(text: string): ProjectNode {
  return {
    id: "t",
    kind: "text",
    title: "文本",
    x: 0,
    y: 0,
    width: 280,
    height: 180,
    z: 1,
    groupId: null,
    origin: "authored",
    createdAt: "2026-09-24T00:00:00.000Z",
    updatedAt: "2026-09-24T00:00:00.000Z",
    outputRevision: 1,
    text,
    phase: "idle",
    freshness: "fresh",
  };
}

const PROMPT_EDGE: ProjectEdge = {
  id: "e1",
  sourceNodeId: "t",
  targetNodeId: "g",
  targetSlotId: "p",
  role: "prompt",
};

test("queued generation 合并后用整图指纹；上游改字则 inputsChangedWhileRunning", () => {
  const text = connectedText("一只纸船");
  const gen = generationNode();
  const nodes = { t: text, g: gen };
  const edges = { e1: PROMPT_EDGE };
  gen.lastAttemptFingerprint = fingerprintNode(gen, nodes, edges);

  const server = createEmptyProject({ projectId: "proj-fp", name: "指纹", now: NOW });
  server.contentRevision = 4;
  server.nodes = { t: structuredClone(text), g: structuredClone(gen) };
  server.edges = structuredClone(edges);

  const changed = mergeWorkingCopy(server, {
    contentRevision: 4,
    nodes: {
      t: connectedText("新的提示词"),
      g: structuredClone(gen),
    },
    edges,
    groups: {},
  });
  assert.equal(changed.ok, true);
  if (changed.ok) {
    assert.equal(changed.project.nodes.g?.phase, "queued");
    assert.equal(changed.project.nodes.g?.inputsChangedWhileRunning, true);
    assert.equal(changed.project.nodes.t?.text, "新的提示词");
  }

  const draftOnly = mergeWorkingCopy(server, {
    contentRevision: 4,
    nodes: {
      t: connectedText("一只纸船"),
      g: generationNode({ promptDraft: "改了草稿但有连线", lastAttemptFingerprint: gen.lastAttemptFingerprint }),
    },
    edges,
    groups: {},
  });
  assert.equal(draftOnly.ok, true);
  if (draftOnly.ok) {
    assert.equal(draftOnly.project.nodes.g?.inputsChangedWhileRunning, false);
    assert.equal(draftOnly.project.nodes.g?.promptDraft, "改了草稿但有连线");
  }
});

test("无提示词连线时改 promptDraft 也会标 inputsChangedWhileRunning", () => {
  const gen = generationNode({
    slots: [{ id: "p", role: "prompt", order: 0, edgeId: null }],
    promptDraft: "原稿",
  });
  const nodes = { g: gen };
  gen.lastAttemptFingerprint = fingerprintNode(gen, nodes, {});
  const server = createEmptyProject({ projectId: "proj-draft", name: "草稿", now: NOW });
  server.contentRevision = 4;
  server.nodes = { g: structuredClone(gen) };

  const result = mergeWorkingCopy(server, {
    contentRevision: 4,
    nodes: {
      g: generationNode({
        slots: [{ id: "p", role: "prompt", order: 0, edgeId: null }],
        promptDraft: "新稿",
        lastAttemptFingerprint: gen.lastAttemptFingerprint,
      }),
    },
    edges: {},
    groups: {},
  });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.project.nodes.g?.inputsChangedWhileRunning, true);
    assert.equal(result.project.nodes.g?.phase, "queued");
  }
});
