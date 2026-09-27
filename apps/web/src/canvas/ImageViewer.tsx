import { useEffect, useRef, type ReactElement } from "react";
import { COPY } from "../ui/copy.ts";
import { ThumbImage } from "./ThumbImage.tsx";
import { consumeViewerWheel } from "./viewerWheel.ts";

/**
 * 挂在画布滚轮监听之外。自己吃掉滚轮，只用缩略图票据。
 * 关上由调用方收起，这里不改相机。
 */
export function ImageViewer(props: {
  token: string;
  thumbRelativePath: string;
  onClose: () => void;
}): ReactElement {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el === null) {
      return;
    }
    const onWheel = (event: WheelEvent): void => {
      consumeViewerWheel(event);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      el.removeEventListener("wheel", onWheel);
    };
  }, []);
  return (
    <div ref={ref} className="image-viewer" data-image-viewer="true" role="dialog">
      <ThumbImage
        token={props.token}
        thumbRelativePath={props.thumbRelativePath}
        needsWorkingCopySync={false}
        alt=""
      />
      <button type="button" className="btn btn-secondary" onClick={props.onClose}>
        {COPY.closeViewer}
      </button>
    </div>
  );
}
