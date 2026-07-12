export function forwardToScreenUp(
  forward: number,
  egoScreenY: number,
  scale: number,
): number {
  return egoScreenY - forward * scale;
}

export function screenXForLeft(
  left: number,
  egoScreenX: number,
  scale: number,
  depthScale = 1,
): number {
  return egoScreenX - left * scale * depthScale;
}

export function egoScreenYForForwardRange(
  panelTop: number,
  panelHeight: number,
  scale: number,
  front: number,
  rear: number,
): number {
  const totalRange = front + rear;
  if (panelHeight <= 0 || totalRange <= 0 || scale <= 0) {
    return panelTop + Math.max(0, panelHeight) / 2;
  }

  const requestedHeight = totalRange * scale;
  if (requestedHeight <= panelHeight) {
    const spareHeight = panelHeight - requestedHeight;
    return panelTop + spareHeight / 2 + front * scale;
  }

  return panelTop + panelHeight * (front / totalRange);
}

export function verticalVisibleBoundsForForwardUp(
  panelTop: number,
  panelBottom: number,
  egoScreenY: number,
  scale: number,
) {
  return {
    minForward: (egoScreenY - panelBottom) / scale,
    maxForward: (egoScreenY - panelTop) / scale,
  };
}
