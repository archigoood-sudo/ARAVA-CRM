import type { CustomerDisplayMonitor } from '@arava/shared';

export interface DisplayLike {
  bounds: { height: number; width: number; x: number; y: number };
  id: number;
  scaleFactor: number;
}

export function describeDisplays(
  displays: DisplayLike[],
  primaryId: number,
): CustomerDisplayMonitor[] {
  return displays.map((display, index) => ({
    height: display.bounds.height,
    id: String(display.id),
    isPrimary: display.id === primaryId,
    label:
      display.id === primaryId
        ? `Основной экран — ${String(display.bounds.width)}×${String(display.bounds.height)}`
        : `Экран ${String(index + 1)} — ${String(display.bounds.width)}×${String(display.bounds.height)}`,
    scaleFactor: display.scaleFactor,
    width: display.bounds.width,
  }));
}

export function selectedSecondaryDisplay<T extends DisplayLike>(
  displays: T[],
  primaryId: number,
  selectedId?: string,
): T | undefined {
  if (displays.length < 2 || !selectedId) return undefined;
  return displays.find((display) => display.id !== primaryId && String(display.id) === selectedId);
}

export function displayBounds(display: DisplayLike) {
  return { ...display.bounds };
}
