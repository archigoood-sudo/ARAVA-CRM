import {
  STUDENT_STATUSES,
  type GroupSummary,
  type StudentBulkAction,
  type StudentBulkAddToGroupInput,
  type StudentBulkChangeStatusInput,
  type StudentBulkExecutionResult,
  type StudentBulkMoveToGroupInput,
  type StudentBulkPreview,
  type StudentBulkRemoveFromGroupInput,
  type StudentStatus,
} from '@arava/shared';
import { Badge, Button, Checkbox, Dialog, Label, Select } from '@arava/ui';
import { useEffect, useMemo, useState } from 'react';

import { getDesktopApi } from '../../lib/desktop-api';
import { getErrorMessage } from '../../lib/errors';
import { localDateInputValue } from '../../lib/local-date';
import { getSessionToken } from '../../stores/auth-store';
import { isStaleBulkPreviewError } from './student-bulk-model';

const actionTitles: Record<StudentBulkAction, string> = {
  ADD_TO_GROUP: 'Добавить в группу',
  CHANGE_STATUS: 'Изменить статус',
  MOVE_TO_GROUP: 'Перевести в другую группу',
  REMOVE_FROM_GROUP: 'Убрать из группы',
};

const statusLabels: Record<StudentStatus, string> = {
  ACTIVE: 'Активен',
  ARCHIVED: 'Архив',
  FROZEN: 'Заморожен',
  LEFT: 'Ушёл',
  TRIAL: 'Пробный',
};

type BulkInput =
  | StudentBulkAddToGroupInput
  | StudentBulkChangeStatusInput
  | StudentBulkMoveToGroupInput
  | StudentBulkRemoveFromGroupInput;

export function StudentBulkDialog({
  action,
  fixedSourceGroupId,
  fixedTargetGroupId,
  groups,
  onClose,
  onSuccess,
  open,
  studentIds,
}: {
  action?: StudentBulkAction | undefined;
  fixedSourceGroupId?: string | undefined;
  fixedTargetGroupId?: string | undefined;
  groups: GroupSummary[];
  onClose: () => void;
  onSuccess: (result: StudentBulkExecutionResult) => void;
  open: boolean;
  studentIds: string[];
}) {
  const [effectiveDate, setEffectiveDate] = useState(localDateInputValue());
  const [sourceGroupId, setSourceGroupId] = useState('');
  const [targetGroupId, setTargetGroupId] = useState('');
  const [status, setStatus] = useState<StudentStatus>('ACTIVE');
  const [overrideCapacity, setOverrideCapacity] = useState(false);
  const [showCapacityOverride, setShowCapacityOverride] = useState(false);
  const [preview, setPreview] = useState<StudentBulkPreview>();
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);
  const targetGroups = useMemo(
    () => groups.filter(({ status }) => status === 'ACTIVE' || status === 'RECRUITING'),
    [groups],
  );

  useEffect(() => {
    if (!open) return;
    setEffectiveDate(localDateInputValue());
    setSourceGroupId(fixedSourceGroupId ?? '');
    setTargetGroupId(fixedTargetGroupId ?? '');
    setStatus('ACTIVE');
    setOverrideCapacity(false);
    setShowCapacityOverride(false);
    setPreview(undefined);
    setError(undefined);
  }, [action, fixedSourceGroupId, fixedTargetGroupId, open]);

  if (!action) return null;

  const buildInput = (): BulkInput | undefined => {
    if (action === 'ADD_TO_GROUP') {
      if (!targetGroupId) return undefined;
      return { effectiveDate, groupId: targetGroupId, overrideCapacity, studentIds };
    }
    if (action === 'MOVE_TO_GROUP') {
      if (!sourceGroupId || !targetGroupId) return undefined;
      return {
        effectiveDate,
        overrideCapacity,
        sourceGroupId,
        studentIds,
        targetGroupId,
      };
    }
    if (action === 'REMOVE_FROM_GROUP') {
      if (!sourceGroupId) return undefined;
      return { effectiveDate, groupId: sourceGroupId, studentIds };
    }
    return { status, studentIds };
  };

  const resetPreview = (keepCapacityOverride = false) => {
    setPreview(undefined);
    setError(undefined);
    if (!keepCapacityOverride) {
      setOverrideCapacity(false);
      setShowCapacityOverride(false);
    }
  };

  const requestPreview = async () => {
    const input = buildInput();
    if (!input) {
      setError('Заполните параметры операции.');
      return;
    }
    setPending(true);
    setError(undefined);
    try {
      const token = getSessionToken();
      const result =
        action === 'ADD_TO_GROUP'
          ? await getDesktopApi().students.previewBulkAddToGroup(
              token,
              input as StudentBulkAddToGroupInput,
            )
          : action === 'MOVE_TO_GROUP'
            ? await getDesktopApi().students.previewBulkMoveToGroup(
                token,
                input as StudentBulkMoveToGroupInput,
              )
            : action === 'REMOVE_FROM_GROUP'
              ? await getDesktopApi().students.previewBulkRemoveFromGroup(
                  token,
                  input as StudentBulkRemoveFromGroupInput,
                )
              : await getDesktopApi().students.previewBulkChangeStatus(
                  token,
                  input as StudentBulkChangeStatusInput,
                );
      setShowCapacityOverride(Boolean(result.capacity?.exceedsCapacity));
      setPreview(result);
    } catch (caught) {
      setError(getErrorMessage(caught, 'Не удалось проверить массовую операцию.'));
    } finally {
      setPending(false);
    }
  };

  const execute = async () => {
    const input = buildInput();
    if (!input || !preview) return;
    setPending(true);
    setError(undefined);
    try {
      const token = getSessionToken();
      const result =
        action === 'ADD_TO_GROUP'
          ? await getDesktopApi().students.bulkAddToGroup(
              token,
              input as StudentBulkAddToGroupInput,
              preview.previewKey,
            )
          : action === 'MOVE_TO_GROUP'
            ? await getDesktopApi().students.bulkMoveToGroup(
                token,
                input as StudentBulkMoveToGroupInput,
                preview.previewKey,
              )
            : action === 'REMOVE_FROM_GROUP'
              ? await getDesktopApi().students.bulkRemoveFromGroup(
                  token,
                  input as StudentBulkRemoveFromGroupInput,
                  preview.previewKey,
                )
              : await getDesktopApi().students.bulkChangeStatus(
                  token,
                  input as StudentBulkChangeStatusInput,
                  preview.previewKey,
                );
      onSuccess(result);
    } catch (caught) {
      const message = getErrorMessage(
        caught,
        `Не удалось выполнить действие «${actionTitles[action]}». Изменения не сохранены.`,
      );
      if (isStaleBulkPreviewError(message)) {
        setPreview(undefined);
        setError('Данные изменились. Проверьте список ещё раз.');
      } else setError(message);
    } finally {
      setPending(false);
    }
  };

  const confirmLabel =
    action === 'ADD_TO_GROUP'
      ? `Добавить ${String(preview?.eligibleCount ?? 0)} учеников`
      : action === 'MOVE_TO_GROUP'
        ? `Перевести ${String(preview?.eligibleCount ?? 0)} учеников`
        : action === 'REMOVE_FROM_GROUP'
          ? `Убрать ${String(preview?.eligibleCount ?? 0)} учеников`
          : `Изменить статус у ${String(preview?.eligibleCount ?? 0)} учеников`;

  return (
    <Dialog
      closeLabel="Закрыть диалог"
      description={`Выбрано учеников: ${String(studentIds.length)}`}
      onClose={onClose}
      open={open}
      title={actionTitles[action]}
    >
      <div className="space-y-5">
        {(action === 'MOVE_TO_GROUP' || action === 'REMOVE_FROM_GROUP') && !fixedSourceGroupId ? (
          <div className="space-y-2">
            <Label>Исходная группа</Label>
            <Select
              aria-label="Исходная группа"
              onChange={(event) => {
                setSourceGroupId(event.target.value);
                resetPreview();
              }}
              value={sourceGroupId}
            >
              <option value="">Выберите группу</option>
              {groups.map((group) => (
                <option key={group.id} value={group.id}>
                  {group.name} · {group.branchName}
                </option>
              ))}
            </Select>
          </div>
        ) : null}

        {(action === 'ADD_TO_GROUP' || action === 'MOVE_TO_GROUP') && !fixedTargetGroupId ? (
          <div className="space-y-2">
            <Label>{action === 'ADD_TO_GROUP' ? 'Группа' : 'Целевая группа'}</Label>
            <Select
              aria-label={action === 'ADD_TO_GROUP' ? 'Группа' : 'Целевая группа'}
              onChange={(event) => {
                setTargetGroupId(event.target.value);
                resetPreview();
              }}
              value={targetGroupId}
            >
              <option value="">Выберите группу</option>
              {targetGroups.map((group) => (
                <option key={group.id} value={group.id}>
                  {group.name} · {group.branchName}
                </option>
              ))}
            </Select>
          </div>
        ) : null}

        {action !== 'CHANGE_STATUS' ? (
          <div className="space-y-2">
            <Label>{action === 'REMOVE_FROM_GROUP' ? 'Дата выхода' : 'Дата изменения'}</Label>
            <input
              aria-label={action === 'REMOVE_FROM_GROUP' ? 'Дата выхода' : 'Дата изменения'}
              className="h-11 w-full rounded-xl border border-border bg-background px-3 text-sm"
              onChange={(event) => {
                setEffectiveDate(event.target.value);
                resetPreview();
              }}
              type="date"
              value={effectiveDate}
            />
          </div>
        ) : (
          <div className="space-y-2">
            <Label>Новый статус</Label>
            <Select
              aria-label="Новый статус"
              onChange={(event) => {
                setStatus(event.target.value as StudentStatus);
                resetPreview();
              }}
              value={status}
            >
              {STUDENT_STATUSES.map((value) => (
                <option key={value} value={value}>
                  {statusLabels[value]}
                </option>
              ))}
            </Select>
          </div>
        )}

        {preview ? (
          <div className="space-y-3 rounded-2xl border border-border bg-muted/35 p-4">
            <div className="flex flex-wrap gap-2">
              <Badge className="bg-emerald-50 text-emerald-700">
                Будет изменено: {preview.eligibleCount}
              </Badge>
              <Badge className="bg-neutral-100 text-neutral-700">
                Без изменений: {preview.skippedCount}
              </Badge>
              <Badge className="bg-red-50 text-red-700">
                Нельзя изменить: {preview.invalidCount}
              </Badge>
            </div>
            {preview.capacity ? (
              <div className="grid grid-cols-2 gap-2 text-sm">
                <span>
                  Сейчас: {preview.capacity.currentCount} из {preview.capacity.capacity}
                </span>
                <span>Добавляется: {preview.capacity.addedCount}</span>
                <span className="col-span-2 font-medium">
                  После операции: {preview.capacity.resultingCount} из {preview.capacity.capacity}
                </span>
              </div>
            ) : null}
            {preview.items
              .filter(({ outcome }) => outcome !== 'ELIGIBLE')
              .map((item) => (
                <div className="text-sm" key={item.studentId}>
                  <span className="font-medium">{item.studentName}</span>
                  <span className="text-muted-foreground"> · {item.reason}</span>
                </div>
              ))}
            {preview.blockingReason ? (
              <p className="text-sm font-medium text-red-600">{preview.blockingReason}</p>
            ) : null}
          </div>
        ) : null}

        {showCapacityOverride ? (
          <label className="flex items-start gap-3 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
            <Checkbox
              checked={overrideCapacity}
              onChange={(event) => {
                setOverrideCapacity(event.target.checked);
                resetPreview(true);
              }}
            />
            <span>Разрешить превышение вместимости с записью в журнале действий.</span>
          </label>
        ) : null}

        {error ? <p className="text-sm text-red-600">{error}</p> : null}

        <div className="flex justify-end gap-3">
          <Button disabled={pending} onClick={onClose} variant="outline">
            Отмена
          </Button>
          {!preview ? (
            <Button disabled={pending} onClick={() => void requestPreview()}>
              {pending ? 'Проверяем…' : 'Проверить изменения'}
            </Button>
          ) : (
            <Button disabled={pending || !preview.canExecute} onClick={() => void execute()}>
              {pending ? 'Сохраняем…' : confirmLabel}
            </Button>
          )}
        </div>
      </div>
    </Dialog>
  );
}
