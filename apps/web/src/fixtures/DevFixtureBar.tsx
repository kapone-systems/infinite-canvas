/**
 * 开发构建加载入口。生产入口不得无条件 import 本文件。
 * 按钮文案含「加载 1000 个测试节点」，正式包里不得出现。
 */
import type { ReactElement } from "react";
import type { EditorStore } from "../canvas/EditorStore.ts";
import { createFixtureLoaders, LOAD_THOUSAND_LABEL } from "./generate.ts";

export { LOAD_THOUSAND_LABEL };

export function DevFixtureBar(props: {
  store: EditorStore;
  disabled?: boolean;
}): ReactElement {
  const loaders = createFixtureLoaders(props.store);
  const disabled = props.disabled === true;
  return (
    <div className="dev-fixture-bar" data-dev-fixtures="true">
      <button
        type="button"
        className="btn btn-secondary"
        disabled={disabled}
        onClick={() => {
          loaders.loadTwenty();
        }}
      >
        加载二十夹具
      </button>
      <button
        type="button"
        className="btn btn-secondary"
        disabled={disabled}
        onClick={() => {
          loaders.loadHundred();
        }}
      >
        加载一百夹具
      </button>
      <button
        type="button"
        className="btn btn-secondary"
        disabled={disabled}
        onClick={() => {
          loaders.loadThousandFar();
        }}
      >
        {LOAD_THOUSAND_LABEL}
      </button>
      <button
        type="button"
        className="btn btn-secondary"
        disabled={disabled}
        onClick={() => {
          loaders.loadOverlap();
        }}
      >
        加载重叠夹具
      </button>
      <button
        type="button"
        className="btn btn-secondary"
        disabled={disabled}
        onClick={() => {
          loaders.loadCopyInternalEdges();
        }}
      >
        加载复制内部边夹具
      </button>
      <button
        type="button"
        className="btn btn-secondary"
        disabled={disabled}
        onClick={() => {
          loaders.injectFakeVariants();
        }}
      >
        注入假变体
      </button>
    </div>
  );
}
