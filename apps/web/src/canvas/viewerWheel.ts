export function consumeViewerWheel(event: {
  preventDefault: () => void;
  stopPropagation: () => void;
}): void {
  event.preventDefault();
  event.stopPropagation();
}
