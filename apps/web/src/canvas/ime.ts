/**
 * 方案第 5.8 节：compositionstart → compositionend 之间不提交命令。
 * compositionupdate 与组字中 Esc 不是已上屏。
 */
export type ImeTracker = {
  start(): void;
  end(): void;
  isComposing(): boolean;
};

export function createImeTracker(): ImeTracker {
  let composing = false;
  return {
    start(): void {
      composing = true;
    },
    end(): void {
      composing = false;
    },
    isComposing(): boolean {
      return composing;
    },
  };
}

export function shouldCommitTextCommand(composing: boolean): boolean {
  return !composing;
}
