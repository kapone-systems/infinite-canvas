import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactElement,
} from "react";
import { USER_FACING, generationHasSettledSuccess, type RunPlan } from "@canvas/schema";
import {
  createProject,
  emptyProjectTrash,
  getCurrentProject,
  ingestMediaFile,
  openProject,
  probeHealth,
  putViewport,
  putWorkingCopy,
  saveCurrentProject,
  saveProjectAs,
} from "./api/client.ts";
import { AudioNodeView } from "./canvas/AudioNode.tsx";
import { DevToolsHost } from "./canvas/DevToolsHost.tsx";
import { EditorStore } from "./canvas/EditorStore.ts";
import { GenerationNodeView } from "./canvas/GenerationNode.tsx";
import { ImageNodeView } from "./canvas/ImageNode.tsx";
import { ImageViewer } from "./canvas/ImageViewer.tsx";
import { VideoNodeView } from "./canvas/VideoNode.tsx";
import { VideoViewer } from "./canvas/VideoViewer.tsx";
import { screenToWorld } from "./canvas/coords.ts";
import { planLod } from "./canvas/lod.ts";
import { HEALTH_DEADLINE_MS, HEALTH_POLL_MS } from "./canvas/metrics.ts";
import { NodeChrome } from "./canvas/NodeChrome.tsx";
import { TextNodeView } from "./canvas/TextNode.tsx";
import { ThumbImage } from "./canvas/ThumbImage.tsx";
import { Viewport } from "./canvas/Viewport.tsx";
import { applyRunEvent } from "./execution/applyRunEvent.ts";
import {
  cancelTask,
  connectSshComfy,
  deleteSecret,
  disconnectSshComfy,
  getAppConfig,
  getRun,
  getSecretPresent,
  getSshComfy,
  getUseLocalComfy,
  postRun,
  putComfyBaseUrl,
  putSecret,
  putSshComfy,
  putUseLocalComfy,
  recheckComfy,
  regeneratePreview,
  retryFailed,
  SETTINGS_SECRET_PROVIDER_ID,
  type SshComfyView,
} from "./execution/client.ts";
import { subscribeRunEvents } from "./execution/events.ts";
import { createFlushGate } from "./execution/flushGate.ts";
import { overlayLabelFor } from "./execution/progressDisplay.ts";
import {
  attachTaskIds,
  optimisticAfterCancel,
  optimisticClearedByPatch,
  submitEmittedRun,
  type OptimisticRun,
} from "./execution/runFlow.ts";
import { patchesFromSnapshot, runningRunIds } from "./execution/snapshot.ts";
import { readSessionTokenFromWindow } from "./session/token.ts";
import { Banner, DisconnectBanner } from "./ui/Banner.tsx";
import { autosaveNoticeWhileOpen, noticeFromAutosaveError } from "./ui/autosaveNotice.ts";
import { ConfirmRunForm } from "./ui/ConfirmRunForm.tsx";
import { COPY } from "./ui/copy.ts";
import { ConnectingPage, DisconnectedPage } from "./ui/DisconnectedPage.tsx";
import { EmptyCanvasState, NoProjectState } from "./ui/EmptyState.tsx";
import { Inspector } from "./ui/Inspector.tsx";
import { PastePathForm } from "./ui/PastePathForm.tsx";
import { SaveAsForm } from "./ui/SaveAsForm.tsx";
import { SettingsForm } from "./ui/SettingsForm.tsx";
import { Toolbar } from "./ui/Toolbar.tsx";
import { TopBar } from "./ui/TopBar.tsx";

type Screen = "loading" | "disconnected" | "no-project" | "project";
type FormMode = "create" | "open" | "save-as" | null;
type ConfirmRun =
  | { kind: "node"; nodeId: string; message: string }
  | { kind: "selection"; message: string };

function createStore(): EditorStore {
  return new EditorStore();
}

function applySshView(
  view: SshComfyView,
  setHost: (value: string) => void,
  setPort: (value: string) => void,
  setUsername: (value: string) => void,
  setRemotePort: (value: string) => void,
  setConnected: (value: boolean) => void,
  setLocalPort: (value: number | null) => void,
): void {
  if (!view.configured) {
    setConnected(false);
    setLocalPort(null);
    return;
  }
  setHost(view.host);
  setPort(String(view.port));
  setUsername(view.username);
  setRemotePort(String(view.remoteComfyPort));
  setConnected(view.connected);
  setLocalPort(view.connected && view.localPort !== undefined ? view.localPort : null);
}

function parsePort(raw: string): number | null {
  if (!/^\d+$/.test(raw)) {
    return null;
  }
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > 65535) {
    return null;
  }
  return value;
}

export function App(): ReactElement {
  const storeRef = useRef<EditorStore | null>(null);
  if (storeRef.current === null) {
    storeRef.current = createStore();
  }
  const store = storeRef.current;
  const snap = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);

  const [screen, setScreen] = useState<Screen>("loading");
  const [bootKey, setBootKey] = useState(0);
  const [token, setToken] = useState<string | null>(null);
  const [midDisconnect, setMidDisconnect] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [missingMedia, setMissingMedia] = useState<readonly string[]>([]);
  const [viewer, setViewer] = useState<{ kind: "image" | "video"; path: string } | null>(null);
  const setViewerThumb = (next: string | null): void => {
    setViewer(next === null ? null : { kind: "image", path: next });
  };
  const [formMode, setFormMode] = useState<FormMode>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [formBusy, setFormBusy] = useState(false);
  const [confirmRun, setConfirmRun] = useState<ConfirmRun | null>(null);
  const [lastPlan, setLastPlan] = useState<RunPlan | null>(null);
  const [optimistic, setOptimisticState] = useState<OptimisticRun | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsBusy, setSettingsBusy] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [settingsUrl, setSettingsUrl] = useState("");
  const [settingsProbe, setSettingsProbe] = useState<string | null>(null);
  const [settingsReachable, setSettingsReachable] = useState<boolean | null>(null);
  const [secretPresent, setSecretPresent] = useState<boolean | null>(null);
  const [secretDraft, setSecretDraft] = useState("");
  const [secretError, setSecretError] = useState<string | null>(null);
  const [sshHost, setSshHost] = useState("");
  const [sshPort, setSshPort] = useState("");
  const [sshUsername, setSshUsername] = useState("");
  const [sshRemotePort, setSshRemotePort] = useState("");
  const [sshSecret, setSshSecret] = useState("");
  const [sshConnected, setSshConnected] = useState(false);
  const [sshLocalPort, setSshLocalPort] = useState<number | null>(null);
  const [sshDetail, setSshDetail] = useState<string | null>(null);
  const [useLocalComfy, setUseLocalComfy] = useState(false);
  const [runRejectMessage, setRunRejectMessage] = useState<string | null>(null);
  const [composing, setComposing] = useState(false);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [textEditing, setTextEditing] = useState(false);
  const canvasHostRef = useRef<HTMLDivElement>(null);
  const [viewSize, setViewSize] = useState({ width: 1280, height: 720 });

  const tokenRef = useRef<string | null>(null);
  const midRef = useRef(false);
  const flushGate = useRef(createFlushGate());
  const optimisticRef = useRef<OptimisticRun | null>(null);
  const subscriptions = useRef(new Map<string, () => void>());

  const setOptimistic = (value: OptimisticRun | null): void => {
    optimisticRef.current = value;
    setOptimisticState(value);
  };

  tokenRef.current = token;
  midRef.current = midDisconnect;

  const flushWorkingCopy = useCallback(async (): Promise<boolean> => {
    return flushGate.current.run(async () => {
      const currentToken = tokenRef.current;
      if (currentToken === null) {
        return false;
      }
      let again = true;
      let ok = true;
      while (again) {
        again = false;
        while (store.getSnapshot().needsWorkingCopySync) {
          if (store.getSnapshot().gestureActive) {
            break;
          }
          if (midRef.current) {
            ok = false;
            break;
          }
          const generation = store.syncGeneration();
          const body = store.workingCopyBody();
          if (body === null) {
            ok = false;
            break;
          }
          const result = await putWorkingCopy(currentToken, body);
          if (!result.ok) {
            ok = false;
            if (result.network) {
              midRef.current = true;
              setMidDisconnect(true);
              break;
            }
            if (result.message === COPY.textTooLong) {
              setNotice(COPY.textTooLong);
              break;
            }
            if (result.status === 409) {
              const latest = await getCurrentProject(currentToken);
              if (latest.ok) {
                store.absorbServerFields(latest.data.project);
                again = true;
                ok = true;
                break;
              }
              store.markWorkingCopyBlocked();
              setNotice(COPY.workingCopySyncFailed);
              break;
            }
            store.markWorkingCopyBlocked();
            setNotice(COPY.workingCopySyncFailed);
            break;
          }
          store.acknowledgeWorkingCopy(result.data.contentRevision, generation);
        }
        if (!ok) {
          break;
        }
      }
      return ok && !store.getSnapshot().needsWorkingCopySync && !store.getSnapshot().workingCopyBlocked;
    });
  }, [store]);

  const disposeSubscriptions = useCallback((): void => {
    for (const stop of subscriptions.current.values()) {
      stop();
    }
    subscriptions.current.clear();
  }, []);

  const handleExecutionEvent = useCallback(
    (event: import("@canvas/schema").RunEvent): void => {
      applyRunEvent(store, event);
      if (event.type === "run.planned") {
        setLastPlan(event.plan);
      }
      if (event.type !== "node.patch") {
        return;
      }
      const current = optimisticRef.current;
      if (current === null || current.nodeId !== event.nodeId) {
        return;
      }
      const taskId = event.patch.lastTaskId ?? current.taskId;
      if (current.pendingCancel && taskId != null && taskId.length > 0) {
        const tokenNow = tokenRef.current;
        if (tokenNow !== null) {
          void cancelTask(tokenNow, taskId);
        }
        setOptimistic({
          ...current,
          pendingCancel: false,
          taskId,
          runId: event.runId ?? current.runId,
          cancelling: true,
          label: COPY.cancelling,
        });
        return;
      }
      if (current.cancelling) {
        const phase = event.patch.phase;
        if (phase !== undefined && phase !== "queued" && phase !== "running") {
          setOptimistic(null);
        }
        return;
      }
      if (optimisticClearedByPatch(event.patch.phase)) {
        setOptimistic(null);
      }
    },
    [store],
  );

  const subscribeRun = useCallback(
    (runId: string): void => {
      const tokenNow = tokenRef.current;
      if (tokenNow === null || subscriptions.current.has(runId)) {
        return;
      }
      const stop = subscribeRunEvents({
        runId,
        token: tokenNow,
        location: { protocol: window.location.protocol, host: window.location.host },
        onEvent: handleExecutionEvent,
      });
      subscriptions.current.set(runId, stop);
    },
    [handleExecutionEvent],
  );

  const restoreRunningTasks = useCallback(
    async (tokenNow: string): Promise<void> => {
      const nodes = Object.values(store.nodeMap());
      const ids = runningRunIds(nodes);
      for (const runId of ids) {
        const snapshot = await getRun(tokenNow, runId);
        if (snapshot.ok && snapshot.data.state === "running") {
          for (const item of patchesFromSnapshot(snapshot.data)) {
            store.applyNodePatch(item.nodeId, item.patch);
          }
          subscribeRun(runId);
          continue;
        }
        const message = snapshot.ok
          ? snapshot.data.summary || USER_FACING.restartUncertain
          : USER_FACING.restartUncertain;
        for (const node of nodes) {
          if (node.lastRunId !== runId) {
            continue;
          }
          if (node.phase !== "queued" && node.phase !== "running") {
            continue;
          }
          const hasSuccess = generationHasSettledSuccess(node);
          store.applyNodePatch(node.id, {
            phase: hasSuccess ? "succeeded" : "idle",
            progress: null,
            lastError: { code: "RESTART_UNCERTAIN", message },
          });
        }
      }
    },
    [store, subscribeRun],
  );

  useEffect(() => {
    return () => {
      disposeSubscriptions();
    };
  }, [disposeSubscriptions]);

  useEffect(() => {
    return store.subscribe(() => {
      const next = store.getSnapshot();
      if (next.needsWorkingCopySync && !next.gestureActive) {
        void flushWorkingCopy();
      }
    });
  }, [flushWorkingCopy, store]);

  useEffect(() => {
    let cancelled = false;
    const started = Date.now();

    const boot = async (): Promise<void> => {
      disposeSubscriptions();
      setOptimistic(null);
      setScreen("loading");
      setMidDisconnect(false);
      setNotice(null);
      setFormMode(null);
      setFormError(null);
      const nextToken = readSessionTokenFromWindow();
      setToken(nextToken);
      tokenRef.current = nextToken;
      const budget = Math.max(200, HEALTH_DEADLINE_MS - (Date.now() - started));
      const healthy = await probeHealth(budget);
      if (cancelled) {
        return;
      }
      if (!healthy || nextToken === null) {
        store.clear();
        setScreen("disconnected");
        return;
      }
      const current = await getCurrentProject(nextToken);
      if (cancelled) {
        return;
      }
      if (current.ok === false && (current.network || current.status === 401 || current.status === 0)) {
        store.clear();
        setScreen("disconnected");
        return;
      }
      if (current.ok === false && current.status === 404) {
        store.clear();
        setScreen("no-project");
        return;
      }
      if (!current.ok) {
        store.clear();
        setScreen("disconnected");
        return;
      }
      store.loadProject(current.data.project);
      setScreen("project");
      void restoreRunningTasks(nextToken);
      setMissingMedia(current.data.missingMedia ?? []);
      if (
        current.data.message === COPY.restoredFromAutosave ||
        current.data.message === COPY.openedFromBackup
      ) {
        setNotice(current.data.message);
      }
      if (current.data.autosaveError !== undefined) {
        setNotice(COPY.autosaveFailed);
      }
    };

    void boot();
    return () => {
      cancelled = true;
    };
  }, [bootKey, disposeSubscriptions, restoreRunningTasks, store]);

  useEffect(() => {
    const onHash = (): void => {
      setBootKey((key) => key + 1);
    };
    window.addEventListener("hashchange", onHash);
    return () => {
      window.removeEventListener("hashchange", onHash);
    };
  }, []);

  useEffect(() => {
    if (screen !== "no-project" && screen !== "project") {
      return;
    }
    const timer = window.setInterval(() => {
      void probeHealth(2000).then((ok) => {
        const wasDown = midRef.current;
        midRef.current = !ok;
        setMidDisconnect(!ok);
        if (wasDown && ok) {
          void flushWorkingCopy();
        }
      });
    }, HEALTH_POLL_MS);
    return () => {
      window.clearInterval(timer);
    };
  }, [flushWorkingCopy, screen]);

  useEffect(() => {
    if (screen !== "project") {
      return;
    }
    const timer = window.setInterval(() => {
      if (!autosaveNoticeWhileOpen({ gestureActive: store.getSnapshot().gestureActive }).query) {
        return;
      }
      const tokenNow = tokenRef.current;
      if (tokenNow === null || midRef.current) {
        return;
      }
      void getCurrentProject(tokenNow).then((current) => {
        if (!current.ok) {
          return;
        }
        const autosaveNotice = noticeFromAutosaveError(current.data.autosaveError?.message);
        if (autosaveNotice !== null) {
          setNotice(autosaveNotice);
          return;
        }
        setNotice((prev) => (prev === COPY.autosaveFailed ? null : prev));
      });
    }, HEALTH_POLL_MS);
    return () => {
      window.clearInterval(timer);
    };
  }, [screen, store]);

  const retry = (): void => {
    setBootKey((key) => key + 1);
  };

  const handleCameraCommit = (camera: typeof snap.camera): void => {
    store.setCamera(camera);
    const currentToken = tokenRef.current;
    if (currentToken === null || midRef.current) {
      return;
    }
    void putViewport(currentToken, camera).then((result) => {
      if (result.ok) {
        return;
      }
      if (result.network) {
        midRef.current = true;
        setMidDisconnect(true);
        return;
      }
      setNotice(COPY.viewportSaveFailed);
    });
  };

  useEffect(() => {
    const el = canvasHostRef.current;
    if (el === null) {
      return;
    }
    const resize = new ResizeObserver(() => {
      setViewSize({
        width: el.clientWidth || 1280,
        height: el.clientHeight || 720,
      });
    });
    resize.observe(el);
    return () => {
      resize.disconnect();
    };
  }, [screen]);

  const handleAddText = (): void => {
    store.addTextNode();
  };

  const handleAddGeneration = (profileId: string): void => {
    store.addGenerationNode(profileId);
  };

  const handleRunThis = (nodeId: string, confirmed = false): void => {
    const result = store.emitRunThisNode(nodeId, confirmed);
    if (!result.ok && result.needsConfirm === true) {
      setConfirmRun({
        kind: "node",
        nodeId,
        message: result.confirmMessage ?? COPY.runFreshConfirm,
      });
      return;
    }
    void (async () => {
      const tokenNow = tokenRef.current;
      if (tokenNow === null) {
        return;
      }
      const submitted = await submitEmittedRun({
        emit: result,
        nodeId,
        flushWorkingCopy,
        postRun: (request) => postRun(tokenNow, request),
        setOptimistic,
      });
      if (submitted.needsConfirm) {
        setConfirmRun({
          kind: "node",
          nodeId,
          message: submitted.message ?? COPY.runFreshConfirm,
        });
        return;
      }
      if (!submitted.posted) {
        if (submitted.message !== null) {
          setNotice(submitted.message);
        }
        setRunRejectMessage(submitted.message);
        return;
      }
      setRunRejectMessage(null);
      if (submitted.snapshot !== null) {
        setLastPlan(submitted.snapshot.plan);
        const next = attachTaskIds(optimisticRef.current ?? {
          nodeId,
          clientRequestId: submitted.request?.clientRequestId ?? "",
          label: COPY.handingToLocalQueue,
          cancelling: false,
          pendingCancel: false,
          taskId: null,
          runId: submitted.snapshot.runId,
        }, submitted.snapshot);
        setOptimistic(next);
        subscribeRun(submitted.snapshot.runId);
        if (next.pendingCancel && next.taskId !== null) {
          void cancelTask(tokenNow, next.taskId);
          setOptimistic({ ...next, pendingCancel: false, cancelling: true, label: COPY.cancelling });
        }
      }
    })();
  };

  const handleCancelThis = (nodeId: string): void => {
    const node = store.nodeMap()[nodeId];
    const taskId = optimisticRef.current?.taskId ?? node?.lastTaskId ?? null;
    const prev =
      optimisticRef.current !== null && optimisticRef.current.nodeId === nodeId
        ? optimisticRef.current
        : {
            nodeId,
            clientRequestId: "",
            label: COPY.cancelling,
            cancelling: true,
            pendingCancel: taskId == null,
            taskId,
            runId: node?.lastRunId ?? null,
          };
    setOptimistic(optimisticAfterCancel(prev, taskId));
    if (taskId != null && taskId.length > 0) {
      const tokenNow = tokenRef.current;
      if (tokenNow !== null) {
        void cancelTask(tokenNow, taskId);
      }
    }
  };

  const handleRunDownstream = (nodeId: string): void => {
    const tokenNow = tokenRef.current;
    if (tokenNow === null) {
      return;
    }
    const result = store.emitRunDownstream(nodeId);
    void (async () => {
      const submitted = await submitEmittedRun({
        emit: result,
        nodeId: null,
        flushWorkingCopy,
        postRun: (request) => postRun(tokenNow, request),
        setOptimistic,
      });
      if (!submitted.posted) {
        if (submitted.message !== null) {
          setNotice(submitted.message);
        }
        setRunRejectMessage(submitted.message);
        return;
      }
      setRunRejectMessage(null);
      if (submitted.snapshot !== null) {
        setLastPlan(submitted.snapshot.plan);
        subscribeRun(submitted.snapshot.runId);
      }
    })();
  };

  const handleRunSelection = (confirmed = false): void => {
    const result = store.emitRunSelection(confirmed);
    if (!result.ok && result.needsConfirm === true) {
      setConfirmRun({
        kind: "selection",
        message: result.confirmMessage ?? COPY.runSelectionConfirm,
      });
      return;
    }
    const tokenNow = tokenRef.current;
    if (tokenNow === null) {
      return;
    }
    void (async () => {
      const submitted = await submitEmittedRun({
        emit: result,
        nodeId: null,
        flushWorkingCopy,
        postRun: (request) => postRun(tokenNow, request),
        setOptimistic,
      });
      if (submitted.needsConfirm) {
        setConfirmRun({
          kind: "selection",
          message: submitted.message ?? COPY.runSelectionConfirm,
        });
        return;
      }
      if (!submitted.posted) {
        if (submitted.message !== null) {
          setNotice(submitted.message);
        }
        setRunRejectMessage(submitted.message);
        return;
      }
      setRunRejectMessage(null);
      if (submitted.snapshot !== null) {
        setLastPlan(submitted.snapshot.plan);
        subscribeRun(submitted.snapshot.runId);
      }
    })();
  };

  const handleRetryFailed = (): void => {
    const tokenNow = tokenRef.current;
    if (tokenNow === null) {
      return;
    }
    const nodes = store.nodeMap();
    const planIds = lastPlan?.nodes.map((row) => row.nodeId) ?? [];
    const selected = snap.selectedIds
      .map((id) => nodes[id])
      .filter((node): node is NonNullable<typeof node> => node !== undefined);
    const candidates = [
      ...selected.filter((node) => node.kind === "generation"),
      ...planIds.map((id) => nodes[id]).filter((node): node is NonNullable<typeof node> => node !== undefined && node.kind === "generation"),
    ];
    const target = candidates.find((node) => {
      const version = (node.versions ?? []).find((item) => item.id === node.currentVersionId);
      return node.lastRunId != null && version?.variants.some((item) => item.phase === "failed") === true;
    });
    const runId = target?.lastRunId;
    if (runId == null) {
      return;
    }
    void (async () => {
      const result = await retryFailed(tokenNow, runId);
      if (!result.ok) {
        setNotice(result.message);
        return;
      }
      setLastPlan(result.data.plan);
      subscribeRun(result.data.runId);
    })();
  };

  const handleSave = async (): Promise<void> => {
    const currentToken = tokenRef.current;
    if (currentToken === null || midRef.current) {
      return;
    }
    const flushed = await flushWorkingCopy();
    if (!flushed) {
      return;
    }
    const result = await saveCurrentProject(currentToken);
    if (!result.ok) {
      if (result.network) {
        midRef.current = true;
        setMidDisconnect(true);
        return;
      }
      if (result.status === 409) {
        setNotice(COPY.saveConflict);
        setFormMode("save-as");
        setFormError(COPY.saveConflict);
        return;
      }
      setNotice(COPY.saveFailed);
      return;
    }
    store.markSaved(result.data.contentRevision, result.data.savedContentRevision);
    if (notice === COPY.saveFailed || notice === COPY.saveConflict) {
      setNotice(null);
    }
  };

  const handleCreate = async (parentDir: string, name: string): Promise<void> => {
    const currentToken = tokenRef.current;
    if (currentToken === null || midRef.current) {
      return;
    }
    setFormBusy(true);
    setFormError(null);
    const result = await createProject(currentToken, { parentDir, name });
    setFormBusy(false);
    if (!result.ok) {
      if (result.network) {
        midRef.current = true;
        setMidDisconnect(true);
        return;
      }
      setFormError(result.message);
      return;
    }
    store.loadProject(result.data.project);
    setScreen("project");
    setFormMode(null);
    setNotice(null);
  };

  const handleOpen = async (absolutePath: string): Promise<void> => {
    const currentToken = tokenRef.current;
    if (currentToken === null || midRef.current) {
      return;
    }
    setFormBusy(true);
    setFormError(null);
    const result = await openProject(currentToken, { absolutePath });
    setFormBusy(false);
    if (!result.ok) {
      if (result.network) {
        midRef.current = true;
        setMidDisconnect(true);
        return;
      }
      setFormError(result.message);
      if (result.message === COPY.schemaVersionNewer || result.message === COPY.schemaVersionUnsupported) {
        setNotice(result.message);
      }
      return;
    }
    store.loadProject(result.data.project);
    setScreen("project");
    setFormMode(null);
    setMissingMedia(result.data.missingMedia ?? []);
    const openedMessage = result.data.message ?? null;
    setNotice(
      openedMessage === COPY.restoredFromAutosave || openedMessage === COPY.openedFromBackup
        ? openedMessage
        : null,
    );
    void restoreRunningTasks(currentToken);
  };

  const handleSaveAs = async (parentDir: string, name: string): Promise<void> => {
    const currentToken = tokenRef.current;
    if (currentToken === null || midRef.current) {
      return;
    }
    const flushed = await flushWorkingCopy();
    if (!flushed) {
      return;
    }
    setFormBusy(true);
    setFormError(null);
    const result = await saveProjectAs(currentToken, { parentDir, name });
    setFormBusy(false);
    if (!result.ok) {
      if (result.network) {
        midRef.current = true;
        setMidDisconnect(true);
        return;
      }
      setFormError(result.message);
      return;
    }
    store.loadProject(result.data.project);
    setScreen("project");
    setFormMode(null);
    setNotice(null);
  };

  if (screen === "loading") {
    return <ConnectingPage />;
  }

  if (screen === "disconnected") {
    return <DisconnectedPage onRetry={retry} />;
  }

  const projectName = snap.project?.name ?? null;
  const saveDisabledReason = midDisconnect
    ? COPY.saveDisabledOffline
    : !snap.unsaved
      ? COPY.saveDisabledClean
      : snap.workingCopyBlocked
        ? COPY.workingCopySyncFailed
        : null;
  const canSave = snap.unsaved && !midDisconnect && !snap.workingCopyBlocked && screen === "project";
  const canSaveAs = screen === "project" && !midDisconnect;
  const saveAsDisabledReason = midDisconnect ? COPY.saveAsDisabledOffline : null;
  const lodPlan = planLod({
    camera: snap.camera,
    viewport: viewSize,
    nodes: snap.nodes.map((node) => ({
      id: node.id,
      x: node.x,
      y: node.y,
      width: node.width,
      height: node.height,
      hasThumb: node.output?.thumbRelativePath != null,
    })),
  });
  const mountedSet = new Set(lodPlan.mountedIds);
  const thumbSet = new Set(lodPlan.thumbIds);
  const selectedSet = new Set(snap.selectedIds);
  const mountedNodes = snap.nodes.filter((node) => mountedSet.has(node.id));

  if (screen === "no-project") {
    return (
      <div className="app-shell">
        {midDisconnect ? <DisconnectBanner /> : null}
        {notice !== null ? <Banner text={notice} tone="danger" /> : null}
        <main className="page-center">
          <NoProjectState
            onNew={() => {
              setFormMode("create");
              setFormError(null);
            }}
            onOpen={() => {
              setFormMode("open");
              setFormError(null);
            }}
          />
          {formMode === "create" || formMode === "open" ? (
            <PastePathForm
              mode={formMode}
              busy={formBusy}
              error={formError}
              disabled={midDisconnect}
              onSubmitCreate={(parentDir, name) => {
                void handleCreate(parentDir, name);
              }}
              onSubmitOpen={(absolutePath) => {
                void handleOpen(absolutePath);
              }}
              onCancel={() => {
                setFormMode(null);
                setFormError(null);
              }}
            />
          ) : null}
        </main>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <TopBar
        projectName={projectName}
        unsaved={snap.unsaved}
        canSave={canSave}
        saveDisabledReason={saveDisabledReason}
        canSaveAs={canSaveAs}
        saveAsDisabledReason={saveAsDisabledReason}
        onSave={() => {
          void handleSave();
        }}
        onSaveAs={() => {
          setFormMode("save-as");
          setFormError(null);
        }}
        onSettings={() => {
          setSettingsOpen(true);
          setSettingsError(null);
          setSettingsProbe(null);
          setSettingsReachable(null);
          const currentToken = tokenRef.current;
          if (currentToken === null) {
            return;
          }
          setSettingsBusy(true);
          void getAppConfig(currentToken).then((result) => {
            setSettingsBusy(false);
            if (!result.ok) {
              setSettingsError(result.message);
              return;
            }
            setSettingsUrl(result.data.comfyBaseUrl ?? "");
          });
          void getSecretPresent(currentToken, SETTINGS_SECRET_PROVIDER_ID).then((result) => {
            if (!result.ok) {
              setSecretError(result.message);
              setSecretPresent(false);
              return;
            }
            setSecretPresent(result.data.present);
          });
          void getSshComfy(currentToken).then((result) => {
            if (!result.ok) {
              setSshDetail(result.message);
              return;
            }
            applySshView(result.data, setSshHost, setSshPort, setSshUsername, setSshRemotePort, setSshConnected, setSshLocalPort);
            setSshSecret("");
          });
          void getUseLocalComfy(currentToken).then((result) => {
            if (result.ok) {
              setUseLocalComfy(result.data.enabled);
            }
          });
        }}
      />
      {midDisconnect ? <DisconnectBanner /> : null}
      {notice !== null && notice !== COPY.backendDisconnected ? (
        <Banner
          text={notice}
          tone={
            notice === COPY.restoredFromAutosave
              ? "info"
              : "danger"
          }
        />
      ) : null}
      {snap.workingCopyBlocked && notice !== COPY.workingCopySyncFailed ? (
        <Banner text={COPY.workingCopySyncFailed} tone="danger" />
      ) : null}
      <div className="app-body">
        <Toolbar
          onAddText={handleAddText}
          onAddGeneration={handleAddGeneration}
          disabled={false}
          disabledReason={null}
        />
        <div
          className="canvas-host"
          data-canvas-host="true"
          data-gesture-active={snap.gestureActive ? "true" : "false"}
          ref={canvasHostRef}
          onDragOver={(event) => {
            event.preventDefault();
          }}
          onDrop={(event) => {
            event.preventDefault();
            const currentToken = tokenRef.current;
            const host = canvasHostRef.current;
            if (currentToken === null || host === null) {
              return;
            }
            const rect = host.getBoundingClientRect();
            const world = screenToWorld(
              { x: event.clientX - rect.left, y: event.clientY - rect.top },
              store.getSnapshot().camera,
              { width: host.clientWidth || viewSize.width, height: host.clientHeight || viewSize.height },
            );
            const files = [...event.dataTransfer.files];
            void (async () => {
              for (const file of files) {
                const name = file.name.toLowerCase();
                if (file.type === "image/svg+xml" || name.endsWith(".svg")) {
                  setNotice(COPY.ingestSvg);
                  continue;
                }
                const ingested = await ingestMediaFile(currentToken, file, file.name);
                if (!ingested.ok) {
                  setNotice(ingested.message);
                  continue;
                }
                if (ingested.data.media.kind === "video") {
                  store.addImportedVideo(ingested.data.media, world);
                } else if (ingested.data.media.kind === "image") {
                  store.addImportedImage(ingested.data.media, world);
                } else if (ingested.data.media.kind === "audio") {
                  store.addImportedAudio(ingested.data.media, world);
                }
              }
            })();
          }}
        >
          <Viewport
            store={store}
            camera={snap.camera}
            composing={composing}
            textEditing={textEditing}
            mountedIds={lodPlan.mountedIds}
            selectedIds={snap.selectedIds}
            selectedCount={snap.selectedCount}
            nodes={snap.nodes}
            thumbCount={lodPlan.thumbIds.length}
            onCameraCommit={handleCameraCommit}
            onStartTextEdit={(id) => {
              setFocusId(id);
              setTextEditing(true);
            }}
            viewerOpen={viewer !== null}
          >
            {mountedNodes.map((node) => (
              <NodeChrome
                key={node.id}
                node={node}
                selected={selectedSet.has(node.id)}
                cancelling={optimistic?.nodeId === node.id && optimistic.cancelling}
              >
                {node.kind === "text" ? (
                  <TextNodeView
                    node={node}
                    editing={focusId === node.id}
                    onComposingChange={setComposing}
                    onFocusChange={(focused) => {
                      setTextEditing(focused);
                      if (!focused && focusId === node.id) {
                        setFocusId(null);
                      }
                    }}
                    onCommit={(text) => {
                      const result = store.setText(node.id, text);
                      if (!result.ok) {
                        setNotice(result.message);
                      }
                      return result;
                    }}
                    onUndo={() => {
                      store.undo();
                    }}
                    onRedo={() => {
                      store.redo();
                    }}
                  />
                ) : node.kind === "generation" ? (
                  <GenerationNodeView
                    node={node}
                    nodes={store.nodeMap()}
                    edges={store.edgeMap()}
                    token={token}
                    needsWorkingCopySync={snap.needsWorkingCopySync}
                    overlayLabel={overlayLabelFor({
                      optimisticLabel:
                        optimistic?.nodeId === node.id ? optimistic.label : null,
                      progressLabel: node.progress?.label,
                      lastError: node.lastError?.message,
                      hasOutput: node.output != null,
                    })}
                    onAddSlot={(role) => {
                      store.addSlot(node.id, role);
                    }}
                    onPromptDraft={(text) => {
                      const result = store.setPromptDraft(node.id, text);
                      if (!result.ok) {
                        setNotice(result.message);
                      }
                    }}
                    onComposingChange={setComposing}
                    onUndo={() => {
                      store.undo();
                    }}
                    onRedo={() => {
                      store.redo();
                    }}
                    onClickVariant={(variantId) => {
                      store.clickVariant(node.id, variantId);
                    }}
                    missingPaths={missingMedia}
                    onOpenViewer={(path) => {
                      setViewer({ kind: "image", path });
                    }}
                    onOpenProxy={(path) => {
                      setViewer({ kind: "video", path });
                    }}
                  />
                ) : node.kind === "image" ? (
                  <ImageNodeView
                    node={node}
                    token={token}
                    needsWorkingCopySync={snap.needsWorkingCopySync}
                    missingPaths={missingMedia}
                    onOpenViewer={(path) => {
                      setViewer({ kind: "image", path });
                    }}
                  />
                ) : node.kind === "video" ? (
                  <VideoNodeView
                    node={node}
                    token={token}
                    needsWorkingCopySync={snap.needsWorkingCopySync}
                    onOpenProxy={(path) => {
                      setViewer({ kind: "video", path });
                    }}
                  />
                ) : node.kind === "audio" ? (
                  <AudioNodeView
                    node={node}
                    token={token}
                    selected={selectedSet.has(node.id)}
                    needsWorkingCopySync={snap.needsWorkingCopySync}
                  />
                ) : thumbSet.has(node.id) && node.output?.thumbRelativePath ? (
                  <ThumbImage
                    token={token}
                    thumbRelativePath={node.output.thumbRelativePath}
                    needsWorkingCopySync={snap.needsWorkingCopySync}
                    alt={node.title}
                  />
                ) : (
                  <div className="thumb-block" aria-hidden="true" />
                )}
              </NodeChrome>
            ))}
          </Viewport>
          {import.meta.env.DEV ? <DevToolsHost store={store} disabled={midDisconnect} /> : null}
          {snap.empty ? <EmptyCanvasState onAddText={handleAddText} /> : null}
          {formMode === "save-as" ? (
            <div className="overlay-form">
              <SaveAsForm
                busy={formBusy}
                error={formError}
                disabled={midDisconnect}
                disabledReason={saveAsDisabledReason}
                onSubmit={(parentDir, name) => {
                  void handleSaveAs(parentDir, name);
                }}
                onCancel={() => {
                  setFormMode(null);
                  setFormError(null);
                }}
              />
            </div>
          ) : null}
          {settingsOpen ? (
            <div className="overlay-form">
              <SettingsForm
                busy={settingsBusy}
                error={settingsError}
                probeMessage={settingsProbe}
                reachable={settingsReachable}
                comfyBaseUrl={settingsUrl}
                disabled={midDisconnect}
                onComfyBaseUrlChange={setSettingsUrl}
                sshHost={sshHost}
                sshPort={sshPort}
                sshUsername={sshUsername}
                sshRemotePort={sshRemotePort}
                sshSecret={sshSecret}
                sshConnected={sshConnected}
                sshLocalPort={sshLocalPort}
                sshDetail={sshDetail}
                onSshHostChange={setSshHost}
                onSshPortChange={setSshPort}
                onSshUsernameChange={setSshUsername}
                onSshRemotePortChange={setSshRemotePort}
                onSshSecretChange={setSshSecret}
                onSshConnect={() => {
                  const currentToken = tokenRef.current;
                  if (currentToken === null) {
                    return;
                  }
                  const port = parsePort(sshPort);
                  const remotePort = parsePort(sshRemotePort);
                  if (port === null || remotePort === null) {
                    setSshDetail("请求没能完成。");
                    return;
                  }
                  setSettingsBusy(true);
                  setSshDetail(null);
                  void (async () => {
                    if (sshSecret.length > 0) {
                      const saved = await putSshComfy(currentToken, {
                        host: sshHost,
                        port,
                        username: sshUsername,
                        remoteComfyPort: remotePort,
                        secret: sshSecret,
                      });
                      if (!saved.ok) {
                        setSettingsBusy(false);
                        setSshDetail(saved.message);
                        return;
                      }
                      setSshSecret("");
                    }
                    const connected = await connectSshComfy(currentToken);
                    if (!connected.ok) {
                      setSettingsBusy(false);
                      setSshDetail(connected.message);
                      const ssh = await getSshComfy(currentToken);
                      if (ssh.ok) {
                        applySshView(ssh.data, setSshHost, setSshPort, setSshUsername, setSshRemotePort, setSshConnected, setSshLocalPort);
                      }
                      return;
                    }
                    const cfg = await getAppConfig(currentToken);
                    if (cfg.ok) {
                      setSettingsUrl(cfg.data.comfyBaseUrl ?? "");
                    }
                    const ssh = await getSshComfy(currentToken);
                    if (ssh.ok) {
                      applySshView(ssh.data, setSshHost, setSshPort, setSshUsername, setSshRemotePort, setSshConnected, setSshLocalPort);
                    }
                    setSettingsBusy(false);
                  })();
                }}
                onSshDisconnect={() => {
                  const currentToken = tokenRef.current;
                  if (currentToken === null) {
                    return;
                  }
                  setSettingsBusy(true);
                  setSshDetail(null);
                  void disconnectSshComfy(currentToken).then(async (result) => {
                    if (!result.ok) {
                      setSettingsBusy(false);
                      setSshDetail(result.message);
                      return;
                    }
                    const ssh = await getSshComfy(currentToken);
                    if (ssh.ok) {
                      applySshView(ssh.data, setSshHost, setSshPort, setSshUsername, setSshRemotePort, setSshConnected, setSshLocalPort);
                    }
                    setSettingsBusy(false);
                  });
                }}
                useLocalComfy={useLocalComfy}
                onUseLocalComfyChange={setUseLocalComfy}
                onSaveUseLocalComfy={() => {
                  const currentToken = tokenRef.current;
                  if (currentToken === null) {
                    return;
                  }
                  setSettingsBusy(true);
                  setSettingsError(null);
                  void putUseLocalComfy(currentToken, useLocalComfy).then((result) => {
                    setSettingsBusy(false);
                    if (!result.ok) {
                      setSettingsError(result.message);
                    }
                  });
                }}
                onSave={() => {
                  const currentToken = tokenRef.current;
                  if (currentToken === null) {
                    return;
                  }
                  setSettingsBusy(true);
                  setSettingsError(null);
                  const value = settingsUrl.trim();
                  void putComfyBaseUrl(currentToken, value.length === 0 ? null : value).then(async (result) => {
                    setSettingsBusy(false);
                    if (!result.ok) {
                      setSettingsError(result.message);
                      return;
                    }
                    const ssh = await getSshComfy(currentToken);
                    if (ssh.ok) {
                      applySshView(ssh.data, setSshHost, setSshPort, setSshUsername, setSshRemotePort, setSshConnected, setSshLocalPort);
                    }
                  });
                }}
                onRecheck={() => {
                  const currentToken = tokenRef.current;
                  if (currentToken === null) {
                    return;
                  }
                  setSettingsBusy(true);
                  setSettingsError(null);
                  void recheckComfy(currentToken).then((result) => {
                    setSettingsBusy(false);
                    if (!result.ok) {
                      setSettingsError(result.message);
                      setSettingsReachable(null);
                      return;
                    }
                    setSettingsReachable(result.data.reachable);
                    setSettingsProbe(
                      result.data.message.length > 0
                        ? result.data.message
                        : result.data.reachable
                          ? ""
                          : COPY.comfyUnreachable,
                    );
                  });
                }}
                onCancel={() => {
                  setSettingsOpen(false);
                }}
                secretPresent={secretPresent}
                secretDraft={secretDraft}
                secretError={secretError}
                onSecretDraftChange={setSecretDraft}
                onSaveSecret={() => {
                  const currentToken = tokenRef.current;
                  if (currentToken === null) {
                    return;
                  }
                  setSettingsBusy(true);
                  setSecretError(null);
                  void putSecret(currentToken, {
                    providerId: SETTINGS_SECRET_PROVIDER_ID,
                    account: "default",
                    secret: secretDraft,
                  }).then((result) => {
                    setSettingsBusy(false);
                    if (!result.ok) {
                      setSecretError(result.message);
                      return;
                    }
                    setSecretDraft("");
                    setSecretPresent(true);
                    setSecretError(null);
                  });
                }}
                onDeleteSecret={() => {
                  const currentToken = tokenRef.current;
                  if (currentToken === null) {
                    return;
                  }
                  setSettingsBusy(true);
                  setSecretError(null);
                  void deleteSecret(currentToken, SETTINGS_SECRET_PROVIDER_ID).then((result) => {
                    setSettingsBusy(false);
                    if (!result.ok) {
                      setSecretError(result.message);
                      return;
                    }
                    setSecretDraft("");
                    setSecretPresent(false);
                  });
                }}
                onEmptyTrash={() => {
                  const currentToken = tokenRef.current;
                  if (currentToken === null) {
                    return;
                  }
                  setSettingsBusy(true);
                  setSettingsError(null);
                  void emptyProjectTrash(currentToken).then((result) => {
                    setSettingsBusy(false);
                    if (!result.ok) {
                      setSettingsError(result.message);
                    }
                  });
                }}
              />
            </div>
          ) : null}
          {confirmRun !== null ? (
            <div className="overlay-form" data-run-confirm="true">
              <ConfirmRunForm
                message={confirmRun.message}
                onConfirm={() => {
                  const pending = confirmRun;
                  setConfirmRun(null);
                  if (pending.kind === "node") {
                    handleRunThis(pending.nodeId, true);
                  } else {
                    handleRunSelection(true);
                  }
                }}
                onCancel={() => {
                  setConfirmRun(null);
                }}
              />
            </div>
          ) : null}
        </div>
        {/* canvas-host-end */}
        {viewer !== null && token !== null && viewer.kind === "image" ? (
          <ImageViewer
            token={token}
            thumbRelativePath={viewer.path}
            onClose={() => {
              setViewerThumb(null);
            }}
          />
        ) : null}
        {viewer !== null && token !== null && viewer.kind === "video" ? (
          <VideoViewer
            token={token}
            proxyRelativePath={viewer.path}
            onClose={() => {
              setViewerThumb(null);
            }}
          />
        ) : null}
        <Inspector
          nodes={snap.nodes}
          edges={store.edgeMap()}
          groups={store.groupMap()}
          selectedIds={snap.selectedIds}
          lastEmittedRunRequest={snap.lastEmittedRunRequest}
          lastPlan={lastPlan}
          offline={midDisconnect}
          workingCopyBlocked={snap.workingCopyBlocked}
          runRejectMessage={runRejectMessage}
          optimisticThis={
            optimistic === null ? null : { nodeId: optimistic.nodeId, cancelling: optimistic.cancelling }
          }
          canRetryFailed={snap.nodes.some((node) => {
            if (node.kind !== "generation" || node.lastRunId == null) {
              return false;
            }
            const version = (node.versions ?? []).find((item) => item.id === node.currentVersionId);
            return version?.variants.some((item) => item.phase === "failed") === true;
          })}
          onRunThis={(nodeId) => {
            handleRunThis(nodeId, false);
          }}
          onCancelThis={handleCancelThis}
          onRunDownstream={handleRunDownstream}
          onRunSelection={() => {
            handleRunSelection(false);
          }}
          onRetryFailed={handleRetryFailed}
          onParamsChange={(nodeId, params) => {
            store.setParams(nodeId, params);
          }}
          onVariantCountChange={(nodeId, count) => {
            store.setVariantCount(nodeId, count);
          }}
          onSelectVersion={(nodeId, versionId) => {
            store.selectVersion(nodeId, versionId);
          }}
          onRecipeChange={(nodeId, recipeId) => {
            store.setGenerationRecipe(nodeId, recipeId);
          }}
          onRegeneratePreview={(nodeId) => {
            const currentToken = tokenRef.current;
            if (currentToken === null) {
              return;
            }
            void regeneratePreview(currentToken, nodeId).then(async (result) => {
              if (!result.ok) {
                setNotice(result.message);
                return;
              }
              const latest = await getCurrentProject(currentToken);
              if (latest.ok) {
                store.absorbServerFields(latest.data.project);
              }
            });
          }}
          token={token}
        />
      </div>
    </div>
  );
}
