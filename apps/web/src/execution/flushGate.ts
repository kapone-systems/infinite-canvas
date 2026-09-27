/**
 * 工作副本同步。编辑触发的同步还在飞时，运行必须等它结束，
 * 不能把「正在同步」当成「同步失败」。
 */
export function createFlushGate(): {
  run(work: () => Promise<boolean>): Promise<boolean>;
} {
  let inflight: Promise<boolean> | null = null;

  const run = (work: () => Promise<boolean>): Promise<boolean> => {
    if (inflight !== null) {
      return inflight.then(() => run(work));
    }
    const task = (async () => {
      try {
        return await work();
      } finally {
        inflight = null;
      }
    })();
    inflight = task;
    return task;
  };

  return { run };
}
