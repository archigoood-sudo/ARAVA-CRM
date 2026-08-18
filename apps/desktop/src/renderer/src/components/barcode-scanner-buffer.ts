const MAX_BARCODE_LENGTH = 128;
// A packaged renderer can occasionally pause for a frame while React commits a route.
// Keep the per-character guard tolerant of that pause; the average interval below
// still prevents ordinary human typing from being classified as a scanner burst.
const MAX_CHARACTER_GAP_MS = 180;
const MAX_AVERAGE_INTERVAL_MS = 55;

export class BarcodeScannerBuffer {
  private firstAt = 0;
  private lastAt = 0;
  private value = '';

  append(character: string, occurredAt: number): void {
    if (this.lastAt && occurredAt - this.lastAt > MAX_CHARACTER_GAP_MS) this.reset();
    if (!this.value) this.firstAt = occurredAt;
    this.value += character;
    this.lastAt = occurredAt;
    if (this.value.length > MAX_BARCODE_LENGTH) this.reset();
  }

  complete(minimumLength: number): string | undefined {
    const value = this.value;
    const duration = Math.max(1, this.lastAt - this.firstAt);
    const averageInterval = value.length > 1 ? duration / (value.length - 1) : duration;
    this.reset();
    return value.length >= minimumLength && averageInterval <= MAX_AVERAGE_INTERVAL_MS
      ? value
      : undefined;
  }

  isEmpty(): boolean {
    return this.value.length === 0;
  }

  shouldRestart(occurredAt: number): boolean {
    return Boolean(this.lastAt && occurredAt - this.lastAt > MAX_CHARACTER_GAP_MS);
  }

  reset(): void {
    this.firstAt = 0;
    this.lastAt = 0;
    this.value = '';
  }
}
