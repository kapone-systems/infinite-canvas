import type { RunEvent } from "@canvas/schema";
import { USER_FACING } from "@canvas/schema";
import type { EditorStore } from "../canvas/EditorStore.ts";
import { displayProgressLabel } from "./progressDisplay.ts";

export function applyRunEvent(store: EditorStore, event: RunEvent): void {
  if (event.type === "node.patch") {
    store.applyNodePatch(event.nodeId, event.patch, {
      contentRevision: event.contentRevision,
      executionRevision: event.executionRevision,
    });
    return;
  }
  if (event.type === "variant.finished") {
    store.applyVariantFinished(event.nodeId, event.variant);
    return;
  }
  if (event.type === "task.progress.indeterminate") {
    store.applyProgressForTask(event.taskId, {
      ratio: null,
      label: displayProgressLabel(event.label),
    });
    return;
  }
  if (event.type === "task.progress") {
    const max = event.max;
    const ratio = max > 0 ? event.value / max : null;
    store.applyProgressForTask(event.taskId, {
      ratio: ratio != null && Number.isFinite(ratio) ? ratio : null,
      label: displayProgressLabel(USER_FACING.generatingElapsed("…")),
    });
  }
}
