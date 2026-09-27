/**
 * 方案第 5.4 节连线规则与句子。槽已占用 = 替换，不是错误。
 */

import { roleLabel } from "./capabilities.ts";
import { MEDIA_KIND_LABELS, USER_FACING } from "./userFacingMessages.ts";
import type { MediaKind, ProjectEdge, ProjectNode, Slot, SlotRole } from "./types.ts";

export const ROLE_ACCEPTS: Record<SlotRole, MediaKind[]> = {
  prompt: ["text"],
  source_image: ["image"],
  reference_image: ["image"],
  style_reference: ["image"],
  character_reference: ["image"],
  mask: ["image"],
  first_frame: ["image"],
  last_frame: ["image"],
  audio_reference: ["audio"],
};

export type ConnectTarget =
  | { type: "slot"; nodeId: string; slotId: string }
  | { type: "empty" }
  | { type: "far" };

export type ConnectEvaluation =
  | { ok: true; replace: boolean }
  | { ok: false; message: string };

export function mediaKindLabel(kind: MediaKind): string {
  return MEDIA_KIND_LABELS[kind];
}

export function outgoingMediaKind(node: ProjectNode): MediaKind | null {
  if (node.kind === "generation") {
    return node.outputKind ?? null;
  }
  if (node.kind === "text" || node.kind === "image" || node.kind === "video" || node.kind === "audio") {
    return node.kind;
  }
  return null;
}

export function wouldCreateCycle(
  sourceNodeId: string,
  targetNodeId: string,
  edges: Record<string, ProjectEdge>,
  ignoreEdgeId: string | null = null,
): boolean {
  if (sourceNodeId === targetNodeId) {
    return true;
  }
  const outgoing = new Map<string, string[]>();
  for (const edge of Object.values(edges)) {
    if (ignoreEdgeId !== null && edge.id === ignoreEdgeId) {
      continue;
    }
    const list = outgoing.get(edge.sourceNodeId);
    if (list !== undefined) {
      list.push(edge.targetNodeId);
    } else {
      outgoing.set(edge.sourceNodeId, [edge.targetNodeId]);
    }
  }
  const seen = new Set<string>();
  const queue: string[] = [targetNodeId];
  while (queue.length > 0) {
    const id = queue.shift();
    if (id === undefined) {
      break;
    }
    if (id === sourceNodeId) {
      return true;
    }
    if (seen.has(id)) {
      continue;
    }
    seen.add(id);
    for (const next of outgoing.get(id) ?? []) {
      queue.push(next);
    }
  }
  return false;
}

function findSlot(node: ProjectNode, slotId: string): Slot | undefined {
  return node.slots?.find((item) => item.id === slotId);
}

export function evaluateConnect(input: {
  nodes: Record<string, ProjectNode>;
  edges: Record<string, ProjectEdge>;
  sourceNodeId: string;
  target: ConnectTarget;
}): ConnectEvaluation {
  if (input.target.type === "empty") {
    return { ok: false, message: USER_FACING.connectToBlank };
  }
  if (input.target.type === "far") {
    return { ok: false, message: USER_FACING.connectFarLod };
  }

  const source = input.nodes[input.sourceNodeId];
  const target = input.nodes[input.target.nodeId];
  if (source === undefined || target === undefined) {
    return { ok: false, message: USER_FACING.connectToBlank };
  }
  if (input.sourceNodeId === input.target.nodeId) {
    return { ok: false, message: USER_FACING.selfLoop };
  }
  if (target.kind !== "generation") {
    return { ok: false, message: USER_FACING.connectToBlank };
  }
  const slot = findSlot(target, input.target.slotId);
  if (slot === undefined) {
    return { ok: false, message: USER_FACING.connectToBlank };
  }

  const sourceKind = outgoingMediaKind(source);
  if (sourceKind === "video" || source.kind === "video") {
    return { ok: false, message: USER_FACING.videoCannotConnect };
  }

  const accepts = ROLE_ACCEPTS[slot.role];
  if (sourceKind !== null && !accepts.includes(sourceKind)) {
    if (sourceKind === "text" && slot.role === "reference_image") {
      return { ok: false, message: USER_FACING.textToReferenceImage };
    }
    if (sourceKind === "audio" && slot.role === "reference_image") {
      return { ok: false, message: USER_FACING.audioToReferenceImage };
    }
    return {
      ok: false,
      message: USER_FACING.kindMismatch(mediaKindLabel(sourceKind), roleLabel(slot.role)),
    };
  }

  if (wouldCreateCycle(input.sourceNodeId, input.target.nodeId, input.edges, slot.edgeId)) {
    return { ok: false, message: USER_FACING.cycleConnect };
  }

  return { ok: true, replace: slot.edgeId !== null };
}
