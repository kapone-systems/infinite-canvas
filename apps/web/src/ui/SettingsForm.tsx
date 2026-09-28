import { useEffect, useState, type FormEvent, type ReactElement } from "react";
import { COPY } from "./copy.ts";

export function SettingsForm(props: {
  busy: boolean;
  error: string | null;
  probeMessage: string | null;
  reachable: boolean | null;
  comfyBaseUrl: string;
  disabled: boolean;
  onComfyBaseUrlChange: (value: string) => void;
  onSave: () => void;
  onRecheck: () => void;
  onEmptyTrash?: () => void;
  onCancel: () => void;
  secretPresent?: boolean | null;
  secretDraft?: string;
  secretError?: string | null;
  onSecretDraftChange?: (value: string) => void;
  onSaveSecret?: () => void;
  onDeleteSecret?: () => void;
  sshHost?: string;
  sshPort?: string;
  sshUsername?: string;
  sshRemotePort?: string;
  sshSecret?: string;
  sshConnected?: boolean;
  sshLocalPort?: number | null;
  sshDetail?: string | null;
  onSshHostChange?: (value: string) => void;
  onSshPortChange?: (value: string) => void;
  onSshUsernameChange?: (value: string) => void;
  onSshRemotePortChange?: (value: string) => void;
  onSshSecretChange?: (value: string) => void;
  onSshConnect?: () => void;
  onSshDisconnect?: () => void;
  useLocalComfy?: boolean;
  onUseLocalComfyChange?: (value: boolean) => void;
  onSaveUseLocalComfy?: () => void;
}): ReactElement {
  const secretPresent = props.secretPresent ?? null;
  const secretDraft = props.secretDraft ?? "";
  const handleSubmit = (event: FormEvent): void => {
    event.preventDefault();
    if (props.disabled || props.busy) {
      return;
    }
    props.onSave();
  };
  const probeTone =
    props.reachable === true ? "info" : props.reachable === false ? "danger" : null;
  return (
    <form className="path-form" onSubmit={handleSubmit} data-settings="true">
      <h2 className="inspector-title">{COPY.settings}</h2>
      <p className="page-hint">{COPY.comfyUnconfiguredHint}</p>
      <label className="field">
        <span>{COPY.comfyAddressLabel}</span>
        <input
          type="text"
          autoComplete="off"
          spellCheck={false}
          value={props.comfyBaseUrl}
          disabled={props.disabled || props.busy}
          onChange={(event) => {
            props.onComfyBaseUrlChange(event.target.value);
          }}
        />
      </label>
      <section data-remote-computer="">
        <h3 className="inspector-title">{COPY.remoteComputer}</h3>
        <label className="field">
          <span>{COPY.sshHost}</span>
          <input
            type="text"
            autoComplete="off"
            spellCheck={false}
            data-ssh-host=""
            value={props.sshHost ?? ""}
            disabled={props.disabled || props.busy}
            onChange={(event) => {
              props.onSshHostChange?.(event.target.value);
            }}
          />
        </label>
        <label className="field">
          <span>{COPY.sshPort}</span>
          <input
            type="text"
            inputMode="numeric"
            autoComplete="off"
            spellCheck={false}
            data-ssh-port=""
            value={props.sshPort ?? ""}
            disabled={props.disabled || props.busy}
            onChange={(event) => {
              props.onSshPortChange?.(event.target.value);
            }}
          />
        </label>
        <label className="field">
          <span>{COPY.sshUsername}</span>
          <input
            type="text"
            autoComplete="off"
            spellCheck={false}
            data-ssh-username=""
            value={props.sshUsername ?? ""}
            disabled={props.disabled || props.busy}
            onChange={(event) => {
              props.onSshUsernameChange?.(event.target.value);
            }}
          />
        </label>
        <label className="field">
          <span>{COPY.remoteComfyPort}</span>
          <input
            type="text"
            inputMode="numeric"
            autoComplete="off"
            spellCheck={false}
            data-ssh-remote-port=""
            value={props.sshRemotePort ?? ""}
            disabled={props.disabled || props.busy}
            onChange={(event) => {
              props.onSshRemotePortChange?.(event.target.value);
            }}
          />
        </label>
        <label className="field">
          <span>{COPY.sshSecret}</span>
          <input
            type="password"
            autoComplete="off"
            spellCheck={false}
            data-ssh-secret=""
            value={props.sshSecret ?? ""}
            disabled={props.disabled || props.busy}
            onChange={(event) => {
              props.onSshSecretChange?.(event.target.value);
            }}
          />
        </label>
        {props.sshConnected === true && props.sshLocalPort != null ? (
          <p className="page-hint" data-ssh-summary="">
            {`${props.sshUsername ?? ""}@${props.sshHost ?? ""}:${props.sshPort ?? ""} → 本机 127.0.0.1:${props.sshLocalPort}`}
          </p>
        ) : null}
        {props.sshDetail != null && props.sshDetail.length > 0 ? (
          <p className="form-error" role="alert" data-ssh-detail="">
            {props.sshDetail}
          </p>
        ) : null}
        <div className="btn-row">
          {props.sshConnected === true ? (
            <button
              type="button"
              className="btn btn-primary"
              data-ssh-disconnect=""
              disabled={props.disabled || props.busy}
              onClick={() => {
                props.onSshDisconnect?.();
              }}
            >
              {COPY.disconnectRemote}
            </button>
          ) : (
            <button
              type="button"
              className="btn btn-primary"
              data-ssh-connect=""
              disabled={props.disabled || props.busy}
              onClick={() => {
                props.onSshConnect?.();
              }}
            >
              {COPY.connectRemoteComfy}
            </button>
          )}
        </div>
      </section>
      <section data-use-local-comfy="">
        <h3 className="inspector-title">{COPY.useLocalComfy}</h3>
        <label className="field">
          <input
            type="checkbox"
            data-use-local-comfy-toggle=""
            checked={props.useLocalComfy === true}
            disabled={props.disabled || props.busy}
            onChange={(event) => {
              props.onUseLocalComfyChange?.(event.target.checked);
            }}
          />
          <span>{COPY.useLocalComfy}</span>
        </label>
        <p className="page-hint">{COPY.useLocalComfyHint}</p>
        <div className="btn-row">
          <button
            type="button"
            className="btn btn-secondary"
            data-use-local-comfy-save=""
            disabled={props.disabled || props.busy}
            onClick={() => {
              props.onSaveUseLocalComfy?.();
            }}
          >
            {COPY.save}
          </button>
        </div>
      </section>
      {props.error !== null ? (
        <p className="form-error" role="alert">
          {props.error}
        </p>
      ) : null}
      {props.probeMessage !== null && props.probeMessage.length > 0 ? (
        <p className={probeTone === "danger" ? "form-error" : "page-hint"} role="status">
          {props.probeMessage}
        </p>
      ) : props.reachable === false ? (
        <p className="form-error" role="status">
          {COPY.comfyUnreachable}
        </p>
      ) : null}
      <section data-secret-provider="example.cloud">
        <h3 className="inspector-title">example.cloud</h3>
        {secretPresent === null ? null : (
          <p className="field-reason" data-secret-status="">
            {secretPresent ? COPY.secretConfigured : COPY.secretNotConfigured}
          </p>
        )}
        <label className="field">
          <span>密钥</span>
          <input
            type="password"
            autoComplete="off"
            spellCheck={false}
            data-secret-input=""
            value={secretDraft}
            disabled={props.disabled || props.busy}
            onChange={(event) => {
              props.onSecretDraftChange?.(event.target.value);
            }}
          />
        </label>
        {props.secretError != null && props.secretError.length > 0 ? (
          <p className="form-error" role="alert" data-secret-error="">
            {props.secretError}
          </p>
        ) : null}
        <div className="btn-row">
          <button
            type="button"
            className="btn btn-primary"
            data-secret-save=""
            disabled={props.disabled || props.busy}
            onClick={() => {
              props.onSaveSecret?.();
            }}
          >
            {COPY.save}
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            data-secret-delete=""
            disabled={props.disabled || props.busy}
            onClick={() => {
              props.onDeleteSecret?.();
            }}
          >
            删除
          </button>
        </div>
      </section>
      <div className="btn-row">
        <button type="submit" className="btn btn-primary" disabled={props.disabled || props.busy}>
          {COPY.save}
        </button>
        <button
          type="button"
          className="btn btn-secondary"
          disabled={props.disabled || props.busy}
          onClick={props.onRecheck}
        >
          {COPY.recheckComfy}
        </button>
        {props.onEmptyTrash !== undefined ? (
          <button
            type="button"
            className="btn btn-secondary"
            data-empty-trash=""
            disabled={props.disabled || props.busy}
            onClick={props.onEmptyTrash}
          >
            {COPY.emptyTrash}
          </button>
        ) : null}
        <button type="button" className="btn btn-secondary" onClick={props.onCancel}>
          {COPY.cancel}
        </button>
      </div>
    </form>
  );
}

export function SettingsHost(props: {
  token: string;
  disabled: boolean;
  loadConfig: (token: string) => Promise<
    | { ok: true; comfyBaseUrl: string | null }
    | { ok: false; message: string }
  >;
  saveUrl: (
    token: string,
    comfyBaseUrl: string | null,
  ) => Promise<{ ok: true } | { ok: false; message: string }>;
  recheck: (
    token: string,
  ) => Promise<{ ok: true; reachable: boolean; message: string } | { ok: false; message: string }>;
  onClose: () => void;
}): ReactElement {
  const [comfyBaseUrl, setComfyBaseUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [probeMessage, setProbeMessage] = useState<string | null>(null);
  const [reachable, setReachable] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    setBusy(true);
    void props.loadConfig(props.token).then((result) => {
      if (cancelled) {
        return;
      }
      setBusy(false);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setComfyBaseUrl(result.comfyBaseUrl ?? "");
    });
    return () => {
      cancelled = true;
    };
  }, [props.token, props.loadConfig]);

  return (
    <SettingsForm
      busy={busy}
      error={error}
      probeMessage={probeMessage}
      reachable={reachable}
      comfyBaseUrl={comfyBaseUrl}
      disabled={props.disabled}
      onComfyBaseUrlChange={setComfyBaseUrl}
      onSave={() => {
        setBusy(true);
        setError(null);
        const value = comfyBaseUrl.trim();
        void props.saveUrl(props.token, value.length === 0 ? null : value).then((result) => {
          setBusy(false);
          if (!result.ok) {
            setError(result.message);
            return;
          }
          setError(null);
        });
      }}
      onRecheck={() => {
        setBusy(true);
        setError(null);
        void props.recheck(props.token).then((result) => {
          setBusy(false);
          if (!result.ok) {
            setError(result.message);
            setReachable(null);
            return;
          }
          setReachable(result.reachable);
          setProbeMessage(result.message);
        });
      }}
      onCancel={props.onClose}
    />
  );
}
