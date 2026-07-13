export type SourceBox = {
  x: number;
  y: number;
  width: number;
  height: number;
  sourceWidth: number;
  sourceHeight: number;
};

export type SlotSize = { width: number; height: number };

export type VisibleBox = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export function transformCoverBox(box: SourceBox, slot: SlotSize): VisibleBox {
  if (
    box.sourceWidth <= 0
    || box.sourceHeight <= 0
    || slot.width <= 0
    || slot.height <= 0
  ) {
    return { left: 0, top: 0, width: 0, height: 0 };
  }
  const scale = Math.max(slot.width / box.sourceWidth, slot.height / box.sourceHeight);
  const offsetX = (slot.width - box.sourceWidth * scale) / 2;
  const offsetY = (slot.height - box.sourceHeight * scale) / 2;
  const stable = (value: number) => Math.round(value * 1_000_000_000) / 1_000_000_000;
  return {
    left: stable(offsetX + box.x * scale),
    top: stable(offsetY + box.y * scale),
    width: stable(box.width * scale),
    height: stable(box.height * scale),
  };
}
