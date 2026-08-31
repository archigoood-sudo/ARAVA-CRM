import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useCallback, useEffect, useRef } from 'react';

import { BarcodeScannerBuffer } from './barcode-scanner-buffer';

export const SCANNER_MIN_LENGTH_KEY = 'arava-scanner-minimum-length';
export const SCANNER_SETTINGS_EVENT = 'arava-scanner-settings-changed';
export const CARD_ENROLLMENT_SCANNER_ATTRIBUTE = 'data-arava-card-enrollment-scanner';
const SCANNER_BURST_SETTLE_MS = 340;

export function configuredScannerMinimum(): number {
  const parsed = Number(localStorage.getItem(SCANNER_MIN_LENGTH_KEY));
  return Number.isInteger(parsed) && parsed >= 4 && parsed <= 64 ? parsed : 6;
}

export function isCardEnrollmentScannerTarget(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    Boolean(target.closest(`[${CARD_ENROLLMENT_SCANNER_ATTRIBUTE}="true"]`))
  );
}

export function useCardEnrollmentScanner({
  disabled,
  onScan,
  onValueChange,
}: {
  disabled: boolean;
  onScan: (barcode: string) => Promise<void>;
  onValueChange: (barcode: string) => void;
}) {
  const buffer = useRef(new BarcodeScannerBuffer());
  const burstTimer = useRef<number>();
  const scanInFlight = useRef(false);
  const disabledRef = useRef(disabled);
  const onScanRef = useRef(onScan);
  const onValueChangeRef = useRef(onValueChange);
  disabledRef.current = disabled;
  onScanRef.current = onScan;
  onValueChangeRef.current = onValueChange;

  const clearTimer = useCallback(() => {
    if (burstTimer.current) window.clearTimeout(burstTimer.current);
    burstTimer.current = undefined;
  }, []);
  const reset = useCallback(() => {
    clearTimer();
    buffer.current.reset();
  }, [clearTimer]);
  const completeScan = useCallback(() => {
    clearTimer();
    const barcode = buffer.current.complete(configuredScannerMinimum());
    if (!barcode) return false;
    onValueChangeRef.current(barcode);
    if (disabledRef.current || scanInFlight.current) return true;
    scanInFlight.current = true;
    void (async () => {
      try {
        await onScanRef.current(barcode);
      } finally {
        scanInFlight.current = false;
      }
    })();
    return true;
  }, [clearTimer]);
  const onKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLInputElement>) => {
      if (event.ctrlKey || event.metaKey || event.altKey) {
        reset();
        return;
      }
      const occurredAt = event.timeStamp;
      if (event.key === 'Enter') {
        if (completeScan()) {
          event.preventDefault();
          event.stopPropagation();
        }
        return;
      }
      if (event.key.length !== 1 || event.key < '!' || event.key > '~') {
        reset();
        return;
      }
      if (buffer.current.shouldRestart(occurredAt)) reset();
      buffer.current.append(event.key, occurredAt);
      clearTimer();
      burstTimer.current = window.setTimeout(completeScan, SCANNER_BURST_SETTLE_MS);
    },
    [clearTimer, completeScan, reset],
  );

  useEffect(() => reset, [reset]);

  return {
    [CARD_ENROLLMENT_SCANNER_ATTRIBUTE]: 'true',
    onKeyDown,
  };
}
