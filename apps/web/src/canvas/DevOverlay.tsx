import { useEffect, useRef, type ReactElement } from "react";
import type { LodBand } from "./lod.ts";

export type DevOverlayStats = {
  frameMs: number;
  over32: number;
  lod: LodBand;
  mounted: number;
  thumbs: number;
};

export function DevOverlay(props: {
  statsRef: { current: DevOverlayStats };
}): ReactElement | null {
  const preRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    if (!import.meta.env.DEV) {
      return;
    }
    let frames = 0;
    let last = performance.now();
    let raf = 0;
    const tick = (now: number): void => {
      const dt = now - last;
      last = now;
      frames += 1;
      const stats = props.statsRef.current;
      if (dt > 32) {
        stats.over32 += 1;
      }
      stats.frameMs = dt;
      const el = preRef.current;
      if (el !== null) {
        el.textContent =
          `帧间隔 ${dt.toFixed(1)} ms\n` +
          `超过 32ms ${stats.over32} 次\n` +
          `LOD ${stats.lod}\n` +
          `挂载 ${stats.mounted}\n` +
          `视口缩略图 ${stats.thumbs}`;
      }
      raf = window.requestAnimationFrame(tick);
    };
    raf = window.requestAnimationFrame(tick);
    return () => {
      window.cancelAnimationFrame(raf);
      void frames;
    };
  }, [props.statsRef]);

  if (!import.meta.env.DEV) {
    return null;
  }

  return <pre ref={preRef} className="dev-overlay" data-dev-overlay="true" />;
}
