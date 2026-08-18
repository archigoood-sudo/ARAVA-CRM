import type { CardScanResult } from '@arava/shared';
import { ScanLine } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { getDesktopApi } from '../lib/desktop-api';
import { getSessionToken } from '../stores/auth-store';
import { BarcodeScannerBuffer } from './barcode-scanner-buffer';
import { GLOBAL_SEARCH_CLOSE_EVENT } from './global-search';

export const SCANNER_MIN_LENGTH_KEY = 'arava-scanner-minimum-length';
export const SCANNER_SETTINGS_EVENT = 'arava-scanner-settings-changed';

const feedback: Record<CardScanResult, string> = {
  ACCESS_DENIED: 'Нет доступа',
  ARCHIVED: 'Карта находится в архиве',
  BLOCKED: 'Карта заблокирована',
  FREE: 'Карта не привязана',
  LOST: 'Карта потеряна',
  OPENED: 'Клиент открыт',
  UNKNOWN: 'Карта не найдена',
};

function configuredMinimum(): number {
  const parsed = Number(localStorage.getItem(SCANNER_MIN_LENGTH_KEY));
  return Number.isInteger(parsed) && parsed >= 4 && parsed <= 64 ? parsed : 6;
}

type EditableElement = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | HTMLElement;

interface EditableSnapshot {
  element: EditableElement;
  html?: string | undefined;
  selectionEnd?: number | null | undefined;
  selectionStart?: number | null | undefined;
  value?: string | undefined;
}

function editableElement(target: EventTarget | null): EditableElement | undefined {
  if (!(target instanceof HTMLElement)) return undefined;
  if (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  )
    return target;
  return target.closest<HTMLElement>('[contenteditable="true"]') ?? undefined;
}

function snapshotEditable(target: EventTarget | null): EditableSnapshot | undefined {
  const element = editableElement(target);
  if (!element) return undefined;
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    return {
      element,
      selectionEnd: element.selectionEnd,
      selectionStart: element.selectionStart,
      value: element.value,
    };
  }
  if (element instanceof HTMLSelectElement) return { element, value: element.value };
  return { element, html: element.innerHTML };
}

function setNativeValue(element: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const prototype =
    element instanceof HTMLInputElement
      ? HTMLInputElement.prototype
      : HTMLTextAreaElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, 'value')?.set?.call(element, value);
  element.dispatchEvent(new Event('input', { bubbles: true }));
}

function restoreEditable(snapshot: EditableSnapshot | undefined): void {
  if (!snapshot?.element.isConnected) return;
  const { element } = snapshot;
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    setNativeValue(element, snapshot.value ?? '');
    try {
      element.setSelectionRange(snapshot.selectionStart ?? null, snapshot.selectionEnd ?? null);
    } catch {
      // Some input types do not expose a text selection.
    }
    return;
  }
  if (element instanceof HTMLSelectElement) {
    element.value = snapshot.value ?? '';
    element.dispatchEvent(new Event('change', { bubbles: true }));
    return;
  }
  element.innerHTML = snapshot.html ?? '';
  element.dispatchEvent(new Event('input', { bubbles: true }));
}

export function GlobalCardScanner() {
  const navigate = useNavigate();
  const buffer = useRef(new BarcodeScannerBuffer());
  const editableSnapshot = useRef<EditableSnapshot>();
  const minimumLength = useRef(configuredMinimum());
  const [message, setMessage] = useState<string>();
  const hideTimer = useRef<number>();
  const scanQueue = useRef(Promise.resolve());

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

  useLayoutEffect(() => {
    const show = (value: string) => {
      setMessage(value);
      if (hideTimer.current) window.clearTimeout(hideTimer.current);
      hideTimer.current = window.setTimeout(() => setMessage(undefined), 2800);
    };
    const reset = () => {
      buffer.current.reset();
      editableSnapshot.current = undefined;
    };
    const scan = async (barcode: string) => {
      try {
        const result = await getDesktopApi().cards.resolveScan(getSessionToken(), barcode);
        show(
          result.result === 'OPENED' && result.studentName
            ? `Карта найдена · ${result.studentName}`
            : feedback[result.result],
        );
        if (result.result === 'OPENED' && result.studentId) {
          const profilePath = `/students/${result.studentId}`;
          const target = `${profilePath}?openedByCard=1`;
          const activeRoute = window.location.hash.replace(/^#/u, '');
          if (activeRoute !== target) {
            await navigate(target, { replace: activeRoute.startsWith('/students/') });
          }
        }
      } catch {
        show('Не удалось проверить карту');
      }
    };
    const enqueueScan = (barcode: string) => {
      scanQueue.current = scanQueue.current.then(
        () => scan(barcode),
        () => scan(barcode),
      );
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey) {
        reset();
        return;
      }
      const now = performance.now();
      if (event.key === 'Enter') {
        const barcode = buffer.current.complete(minimumLength.current);
        const snapshot = editableSnapshot.current;
        editableSnapshot.current = undefined;
        if (barcode) {
          event.preventDefault();
          event.stopImmediatePropagation();
          restoreEditable(snapshot);
          window.dispatchEvent(new Event(GLOBAL_SEARCH_CLOSE_EVENT));
          enqueueScan(barcode);
        }
        return;
      }
      if (event.key.length !== 1 || event.key < '!' || event.key > '~') {
        reset();
        return;
      }
      if (buffer.current.shouldRestart(now)) reset();
      if (buffer.current.isEmpty()) editableSnapshot.current = snapshotEditable(event.target);
      buffer.current.append(event.key, now);
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
