import { describe, expect, it } from 'vitest';

import { BarcodeScannerBuffer } from './barcode-scanner-buffer';

function append(buffer: BarcodeScannerBuffer, value: string, startAt = 0, interval = 10) {
  for (let index = 0; index < value.length; index += 1) {
    buffer.append(value.charAt(index), startAt + index * interval);
  }
}

describe('BarcodeScannerBuffer', () => {
  it('recognizes rapid scanner input and preserves leading zeroes', () => {
    const buffer = new BarcodeScannerBuffer();
    append(buffer, '0000001001');
    expect(buffer.complete(6)).toBe('0000001001');
  });

  it('does not classify normal human typing as a scan', () => {
    const buffer = new BarcodeScannerBuffer();
    append(buffer, '0000001001', 0, 70);
    expect(buffer.complete(6)).toBeUndefined();
  });

  it('resets after every completed and interrupted attempt', () => {
    const buffer = new BarcodeScannerBuffer();
    for (const barcode of ['0000001001', '0000001002', '0000001001']) {
      append(buffer, barcode, 1_000, 2);
      expect(buffer.complete(6)).toBe(barcode);
      expect(buffer.isEmpty()).toBe(true);
    }

    append(buffer, '000', 0, 2);
    expect(buffer.complete(6)).toBeUndefined();
    append(buffer, '0000001003', 2_000, 2);
    expect(buffer.complete(6)).toBe('0000001003');
  });
});
