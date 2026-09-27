export function resolveThumbSrc(input: {
  ticketId: string | null;
  failed: boolean;
}): { src: string | null; state: "pending" | "thumb-failed" | "thumb-ready" } {
  if (input.failed) {
    return { src: null, state: "thumb-failed" };
  }
  if (input.ticketId === null || input.ticketId.length === 0) {
    return { src: null, state: "pending" };
  }
  return { src: `/api/media-ticket/${input.ticketId}`, state: "thumb-ready" };
}
