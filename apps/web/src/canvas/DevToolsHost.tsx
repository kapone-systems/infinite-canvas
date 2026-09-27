import { useEffect, useState, type ReactElement } from "react";
import type { EditorStore } from "./EditorStore.ts";

export function DevToolsHost(props: {
  store: EditorStore;
  disabled?: boolean;
}): ReactElement | null {
  const [bar, setBar] = useState<ReactElement | null>(null);

  useEffect(() => {
    if (!import.meta.env.DEV) {
      return;
    }
    let cancelled = false;
    void import("../fixtures/DevFixtureBar.tsx").then((mod) => {
      if (cancelled) {
        return;
      }
      setBar(
        <mod.DevFixtureBar store={props.store} disabled={props.disabled === true} />,
      );
    });
    return () => {
      cancelled = true;
    };
  }, [props.disabled, props.store]);

  return bar;
}
