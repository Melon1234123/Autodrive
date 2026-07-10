export function forwardToScreenDown(
  forward: number,
  egoScreenY: number,
  scale: number,
  depthScale = 1,
): number {
  return egoScreenY + forward * scale * depthScale;
}

export function verticalVisibleBounds(
  panelTop: number,
  panelBottom: number,
  egoScreenY: number,
  scale: number,
) {
  return {
    minForward: (panelTop - egoScreenY) / scale,
    maxForward: (panelBottom - egoScreenY) / scale,
  };
}
