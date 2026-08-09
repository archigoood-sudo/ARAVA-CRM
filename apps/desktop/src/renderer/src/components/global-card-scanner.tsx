import type { CardScanResult } from '@arava/shared';
import { ScanLine } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { getDesktopApi } from '../lib/desktop-api';
import { getSessionToken } from '../stores/auth-store';

export const SCANNER_MIN_LENGTH_KEY = 'arava-scanner-minimum-length';
export const SCANNER_SETTINGS_EVENT = 'arava-scanner-settings-changed';

const feedback: Record<CardScanResult, string> = {
  ACCESS_DENIED: 'Нет доступа к клиенту этой карты',
  ARCHIVED: 'Карта находится в архиве',
  BLOCKED: 'Карта заблокирована',
  FREE: 'Карта пока не привязана',
  LOST: 'Карта отмечена как утерянная',
  OPENED: 'Клиент открыт',
  UNKNOWN: 'Карта не зарегистрирована',
};

function configuredMinimum(): number {
  const parsed = Number(localStorage.getItem(SCANNER_MIN_LENGTH_KEY));
  return Number.isInteger(parsed) && parsed >= 4 && parsed <= 64 ? parsed : 6;
}

function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.tagName === 'SELECT'
  );
}

export function GlobalCardScanner() {
  const navigate = useNavigate();
  const buffer = useRef('');
  const firstAt = useRef(0);
  const lastAt = useRef(0);
  const minimumLength = useRef(configuredMinimum());
  const [message, setMessage] = useState<string>();
  const hideTimer = useRef<number>();

  useEffect(() => {
    const updateSettings = () => {
      minimumLength.current = configuredMinimum();
    };
    window.addEventListener('storage', updateSettings);
    window.addEventListener(SCANNER_SETTINGS_EVENT, updateSettings);
    return () => {
      window.removeEventListener('storage', updateSettings);
      window.removeEventListener(SCANNER_SETTINGS_EVENT, updateSettings);
    };
  }, []);

  useEffect(() => {
    const show = (value: string) => {
      setMessage(value);
      if (hideTimer.current) window.clearTimeout(hideTimer.current);
      hideTimer.current = window.setTimeout(() => setMessage(undefined), 2800);
    };
    const reset = () => {
      buffer.current = '';
      firstAt.current = 0;
      lastAt.current = 0;
    };
    const scan = async (barcode: string) => {
      try {
        const result = await getDesktopApi().cards.resolveScan(getSessionToken(), barcode);
        show(
          result.result === 'OPENED' && result.studentName
            ? `Карта найдена · ${result.studentName}`
            : feedback[result.result],
        );
        if (result.result === 'OPENED' && result.studentId)
          await navigate(`/students/${result.studentId}?openedByCard=1`);
      } catch {
        show('Не удалось проверить карту');
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (isEditable(event.target) || event.ctrlKey || event.metaKey || event.altKey) {
        reset();
        return;
      }
      const now = performance.now();
      if (event.key === 'Enter') {
        const value = buffer.current;
        const duration = Math.max(1, lastAt.current - firstAt.current);
        const averageInterval = value.length > 1 ? duration / (value.length - 1) : duration;
        reset();
        if (value.length >= minimumLength.current && averageInterval <= 55) {
          event.preventDefault();
          void scan(value);
        }
        return;
      }
      if (event.key.length !== 1 || event.key < '!' || event.key > '~') {
        reset();
        return;
      }
      if (lastAt.current && now - lastAt.current > 80) reset();
      if (!buffer.current) firstAt.current = now;
      buffer.current += event.key;
      lastAt.current = now;
      if (buffer.current.length > 128) reset();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      if (hideTimer.current) window.clearTimeout(hideTimer.current);
    };
  }, [navigate]);

  if (!message) return null;
  return (
    <div className="pointer-events-none fixed bottom-6 right-6 z-[70] flex max-w-sm animate-soft-rise items-center gap-3 rounded-2xl border border-white/10 bg-sidebar px-4 py-3 text-sm font-semibold text-white shadow-elevated">
      <span className="flex size-9 items-center justify-center rounded-xl bg-accent text-neutral-950">
        <ScanLine className="size-4" />
      </span>
      {message}
    </div>
  );
}
