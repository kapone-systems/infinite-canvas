/**
 * 查看器同一时间只播一个。画布节点不调用这里。
 */
type PlaybackClaim = { id: string; pause: () => void };

let active: PlaybackClaim | null = null;

export function claimPlayback(id: string, pause: () => void): void {
  if (active !== null && active.id !== id) {
    active.pause();
  }
  active = { id, pause };
}

export function releasePlayback(id: string): void {
  if (active !== null && active.id === id) {
    active = null;
  }
}

export function resetPlaybackForTests(): void {
  active = null;
}
