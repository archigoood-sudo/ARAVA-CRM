import {
  formatDate,
  type AttendanceScanLessonOption,
  type AttendanceScanOptions,
  type CardScanResult,
} from '@arava/shared';
import { Badge, Button, Dialog, cn } from '@arava/ui';
import { useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Clock3, ScanLine, UserRound } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { getDesktopApi } from '../lib/desktop-api';
import { getSessionToken, useAuthStore } from '../stores/auth-store';
import { localDateKey } from '../features/attendance/attendance-workspace';
import { BarcodeScannerBuffer } from './barcode-scanner-buffer';
import { GLOBAL_SEARCH_CLOSE_EVENT } from './global-search';

export const SCANNER_MIN_LENGTH_KEY = 'arava-scanner-minimum-length';
export const SCANNER_SETTINGS_EVENT = 'arava-scanner-settings-changed';
const SCANNER_BURST_SETTLE_MS = 340;

const feedback: Record<CardScanResult, string> = {
  ACCESS_DENIED: 'Нет доступа',
  ARCHIVED: 'Карта находится в архиве',
  BLOCKED: 'Карта заблокирована',
  FREE: 'Карта не привязана',
  LOST: 'Карта потеряна',
  OPENED: 'Клиент открыт',
  UNKNOWN: 'Карта не найдена',
};

const attendanceStatusLabels = {
  ABSENT: 'Сейчас: отсутствовал',
  EXCUSED: 'Сейчас: болел',
  LATE: 'Сейчас: опоздал',
  PRESENT: 'Уже отмечен',
  TRIAL: 'Сейчас: пробное занятие',
} as const;

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
  const queryClient = useQueryClient();
  const role = useAuthStore(({ user }) => user?.role);
  const buffer = useRef(new BarcodeScannerBuffer());
  const editableSnapshot = useRef<EditableSnapshot>();
  const minimumLength = useRef(configuredMinimum());
  const [message, setMessage] = useState<string>();
  const [attendancePrompt, setAttendancePrompt] = useState<AttendanceScanOptions>();
  const [selectedLessonId, setSelectedLessonId] = useState<string>();
  const [savingAttendance, setSavingAttendance] = useState(false);
  const hideTimer = useRef<number>();
  const burstTimer = useRef<number>();
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
      if (burstTimer.current) window.clearTimeout(burstTimer.current);
      burstTimer.current = undefined;
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
        if (result.result === 'OPENED' && result.studentId && role !== 'COACH') {
          const options = await getDesktopApi().attendance.scanOptions(
            getSessionToken(),
            result.studentId,
            localDateKey(),
          );
          setAttendancePrompt(options);
          setSelectedLessonId(options.lessons[0]?.id);
        } else if (result.result === 'OPENED' && result.studentId) {
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
    const completeScan = (event?: KeyboardEvent) => {
      if (burstTimer.current) window.clearTimeout(burstTimer.current);
      burstTimer.current = undefined;
      const barcode = buffer.current.complete(minimumLength.current);
      const snapshot = editableSnapshot.current;
      editableSnapshot.current = undefined;
      if (!barcode) return false;
      event?.preventDefault();
      event?.stopImmediatePropagation();
      restoreEditable(snapshot);
      window.dispatchEvent(new Event(GLOBAL_SEARCH_CLOSE_EVENT));
      enqueueScan(barcode);
      return true;
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey) {
        reset();
        return;
      }
      const occurredAt = event.timeStamp;
      if (event.key === 'Enter') {
        completeScan(event);
        return;
      }
      if (event.key.length !== 1 || event.key < '!' || event.key > '~') {
        reset();
        return;
      }
      if (buffer.current.shouldRestart(occurredAt)) reset();
      if (buffer.current.isEmpty()) editableSnapshot.current = snapshotEditable(event.target);
      buffer.current.append(event.key, occurredAt);
      if (burstTimer.current) window.clearTimeout(burstTimer.current);
      burstTimer.current = window.setTimeout(() => completeScan(), SCANNER_BURST_SETTLE_MS);
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      if (hideTimer.current) window.clearTimeout(hideTimer.current);
      if (burstTimer.current) window.clearTimeout(burstTimer.current);
    };
  }, [navigate, role]);

  const selectedLesson = attendancePrompt?.lessons.find(({ id }) => id === selectedLessonId);
  const openStudent = async () => {
    if (!attendancePrompt) return;
    const profilePath = `/students/${attendancePrompt.studentId}`;
    const target = `${profilePath}?openedByCard=1`;
    setAttendancePrompt(undefined);
    await navigate(target, { replace: window.location.hash.includes('/students/') });
  };
  const markPresent = async () => {
    if (!attendancePrompt || !selectedLesson || selectedLesson.currentStatus === 'PRESENT') return;
    setSavingAttendance(true);
    try {
      await getDesktopApi().attendance.confirmScan(getSessionToken(), {
        groupId: selectedLesson.groupId,
        ...(selectedLesson.lessonId ? { lessonId: selectedLesson.lessonId } : {}),
        startsAt: selectedLesson.startsAt,
        studentId: attendancePrompt.studentId,
      });
      setAttendancePrompt({
        ...attendancePrompt,
        lessons: attendancePrompt.lessons.map((lesson) =>
          lesson.id === selectedLesson.id ? { ...lesson, currentStatus: 'PRESENT' } : lesson,
        ),
      });
      setMessage('Посещение отмечено');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['attendance'] }),
        queryClient.invalidateQueries({ queryKey: ['dashboard'] }),
        queryClient.invalidateQueries({ queryKey: ['attention'] }),
        queryClient.invalidateQueries({ queryKey: ['subscriptions'] }),
      ]);
    } catch {
      setMessage('Не удалось отметить посещение');
    } finally {
      setSavingAttendance(false);
    }
  };

  return (
    <>
      {message ? (
        <div className="pointer-events-none fixed bottom-6 right-6 z-[70] flex max-w-sm animate-soft-rise items-center gap-3 rounded-2xl border border-white/10 bg-sidebar px-4 py-3 text-sm font-semibold text-white shadow-elevated">
          <span className="flex size-9 items-center justify-center rounded-xl bg-accent text-neutral-950">
            <ScanLine className="size-4" />
          </span>
          {message}
        </div>
      ) : null}
      <Dialog
        closeLabel="Закрыть"
        description={
          attendancePrompt?.lessons.length
            ? attendancePrompt.lessons.length === 1
              ? 'Подтвердите посещение сегодняшнего занятия'
              : `Сегодня у ученика ${String(attendancePrompt.lessons.length)} занятия`
            : 'Сегодня занятий не найдено'
        }
        footer={
          attendancePrompt ? (
            <div className="flex flex-wrap justify-end gap-2">
              <Button onClick={() => setAttendancePrompt(undefined)} variant="ghost">
                Отмена
              </Button>
              <Button onClick={() => void openStudent()} variant="secondary">
                <UserRound className="size-4" /> Открыть профиль
              </Button>
              {selectedLesson ? (
                <Button
                  disabled={savingAttendance || selectedLesson.currentStatus === 'PRESENT'}
                  onClick={() => void markPresent()}
                >
                  <CheckCircle2 className="size-4" />
                  {selectedLesson.currentStatus === 'PRESENT'
                    ? 'Уже отмечен'
                    : 'Отметить присутствие'}
                </Button>
              ) : null}
            </div>
          ) : undefined
        }
        onClose={() => setAttendancePrompt(undefined)}
        open={Boolean(attendancePrompt)}
        title={attendancePrompt?.studentName ?? 'Посещение по карте'}
      >
        {attendancePrompt?.lessons.length ? (
          <div className="space-y-2">
            {attendancePrompt.lessons.map((lesson) => (
              <AttendanceLessonChoice
                key={lesson.id}
                lesson={lesson}
                onSelect={() => setSelectedLessonId(lesson.id)}
                selected={lesson.id === selectedLessonId}
              />
            ))}
          </div>
        ) : (
          <div className="rounded-2xl bg-muted p-5 text-sm text-muted-foreground">
            Можно открыть профиль ученика. Сканирование карты не изменило посещаемость.
          </div>
        )}
      </Dialog>
    </>
  );
}

function AttendanceLessonChoice({
  lesson,
  onSelect,
  selected,
}: {
  lesson: AttendanceScanLessonOption;
  onSelect: () => void;
  selected: boolean;
}) {
  return (
    <button
      className={cn(
        'flex w-full items-center justify-between gap-4 rounded-2xl border p-4 text-left transition',
        selected ? 'border-neutral-900 bg-neutral-50' : 'border-border hover:bg-muted',
      )}
      onClick={onSelect}
      type="button"
    >
      <div>
        <p className="font-semibold">{lesson.groupName}</p>
        <p className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
          <Clock3 className="size-4" />
          {formatDate(lesson.startsAt, { timeStyle: 'short' })}
          {[lesson.roomName, lesson.effectiveTrainerName].filter(Boolean).join(' · ')}
        </p>
      </div>
      {lesson.currentStatus === 'PRESENT' ? (
        <Badge className="bg-emerald-50 text-emerald-700">✓ Уже отмечен</Badge>
      ) : lesson.currentStatus ? (
        <Badge className="bg-amber-50 text-amber-800">
          {attendanceStatusLabels[lesson.currentStatus]}
        </Badge>
      ) : null}
    </button>
  );
}
