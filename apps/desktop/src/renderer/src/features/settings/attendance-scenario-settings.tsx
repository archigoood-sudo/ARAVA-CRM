import type {
  AttendanceScenarioPayrollEffect,
  AttendanceScenarioReconciliationFilters,
  AttendanceScenarioReconciliationPreview,
  AttendanceScenarioReconciliationResult,
  AttendanceScenarioStatus,
  AttendanceScenarioSubscriptionEffect,
  AttendanceScenarioSummary,
} from '@arava/shared';
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Checkbox,
  Dialog,
  Input,
  Select,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  cn,
} from '@arava/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, History, LoaderCircle } from 'lucide-react';
import { useState } from 'react';

import { getDesktopApi } from '../../lib/desktop-api';
import { getSessionToken, useAuthStore } from '../../stores/auth-store';

const labels: Record<AttendanceScenarioStatus, string> = {
  ABSENT: 'Отсутствовал',
  ILL: 'Болел',
  LATE: 'Опоздал',
  PRESENT: 'Присутствовал',
};

const subscriptionEffects: Record<AttendanceScenarioSubscriptionEffect, string> = {
  DEDUCTED: 'Списано',
  NOT_DEDUCTED: 'Не списано',
};

const payrollEffects: Record<AttendanceScenarioPayrollEffect, string> = {
  EXCLUDED: 'Не учтено',
  INCLUDED: 'Учтено',
  NOT_CALCULATED: 'Не рассчитано',
};

function inputDate(date: Date): string {
  return `${String(date.getFullYear())}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate(),
  ).padStart(2, '0')}`;
}

function initialFilters() {
  const dateTo = new Date();
  const dateFrom = new Date(dateTo.getFullYear(), dateTo.getMonth(), 1);
  return {
    branchId: '',
    dateFrom: inputDate(dateFrom),
    dateTo: inputDate(dateTo),
    groupId: '',
    status: '',
  };
}

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString('ru-RU');
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Не удалось выполнить операцию.';
}

function ScenarioToggle({
  checked,
  disabled,
  label,
  onChange,
}: {
  checked: boolean;
  disabled: boolean;
  label: string;
  onChange: () => void;
}) {
  return (
    <Button
      aria-checked={checked}
      aria-label={label}
      className={cn(
        'h-7 w-12 rounded-full border p-1 transition-colors',
        checked ? 'border-emerald-600 bg-emerald-600' : 'border-border bg-muted',
      )}
      disabled={disabled}
      onClick={onChange}
      role="switch"
      type="button"
      variant="ghost"
    >
      <span
        className={cn(
          'block size-5 rounded-full bg-white shadow-sm transition-transform',
          checked && 'translate-x-5',
        )}
      />
    </Button>
  );
}

function ReconciliationDialog({ onClose, open }: { onClose: () => void; open: boolean }) {
  const [filters, setFilters] = useState(initialFilters);
  const [preview, setPreview] = useState<AttendanceScenarioReconciliationPreview>();
  const [result, setResult] = useState<AttendanceScenarioReconciliationResult>();
  const [confirmed, setConfirmed] = useState(false);
  const branches = useQuery({
    enabled: open,
    queryFn: () => getDesktopApi().branches.list(getSessionToken()),
    queryKey: ['branches', 'attendance-scenario-reconciliation'],
  });
  const groups = useQuery({
    enabled: open,
    queryFn: () => getDesktopApi().groups.list(getSessionToken(), {}),
    queryKey: ['groups', 'attendance-scenario-reconciliation'],
  });
  const normalizedFilters = (): AttendanceScenarioReconciliationFilters => ({
    branchId: filters.branchId || undefined,
    dateFrom: filters.dateFrom,
    dateTo: filters.dateTo,
    groupId: filters.groupId || undefined,
    status: (filters.status || undefined) as AttendanceScenarioStatus | undefined,
  });
  const previewMutation = useMutation({
    mutationFn: () =>
      getDesktopApi().attendance.previewScenarioReconciliation(
        getSessionToken(),
        normalizedFilters(),
      ),
    onSuccess: (next) => {
      setConfirmed(false);
      setPreview(next);
      setResult(undefined);
    },
  });
  const applyMutation = useMutation({
    mutationFn: () =>
      getDesktopApi().attendance.applyScenarioReconciliation(getSessionToken(), {
        filters: preview?.filters ?? normalizedFilters(),
        previewFingerprint: preview?.fingerprint ?? '',
      }),
    onSuccess: setResult,
  });
  const changeFilter = (key: keyof ReturnType<typeof initialFilters>, value: string) => {
    setFilters((current) => ({
      ...current,
      [key]: value,
      ...(key === 'branchId' ? { groupId: '' } : {}),
    }));
    setConfirmed(false);
    setPreview(undefined);
    setResult(undefined);
  };
  const exportResult = () => {
    if (!preview) return;
    const content = JSON.stringify({ preview, result }, null, 2);
    const url = URL.createObjectURL(
      new Blob([content], { type: 'application/json;charset=utf-8' }),
    );
    const link = document.createElement('a');
    link.download = `attendance-scenario-reconciliation-${preview.filters.dateFrom}-${preview.filters.dateTo}.json`;
    link.href = url;
    link.click();
    URL.revokeObjectURL(url);
  };
  const visibleGroups = (groups.data ?? []).filter(
    (group) => !filters.branchId || group.branchId === filters.branchId,
  );

  return (
    <Dialog
      closeLabel="Закрыть применение сценариев"
      description="Сначала CRM покажет только предварительный расчёт. Изменения выполняются после отдельного подтверждения."
      onClose={onClose}
      open={open}
      title="Применить сценарии к прошлым занятиям"
      wide
    >
      <div className="grid gap-4 md:grid-cols-2">
        <label className="space-y-1.5 text-sm font-medium">
          Дата с
          <Input
            aria-label="Дата начала применения сценариев"
            onChange={(event) => changeFilter('dateFrom', event.target.value)}
            type="date"
            value={filters.dateFrom}
          />
        </label>
        <label className="space-y-1.5 text-sm font-medium">
          Дата по
          <Input
            aria-label="Дата окончания применения сценариев"
            onChange={(event) => changeFilter('dateTo', event.target.value)}
            type="date"
            value={filters.dateTo}
          />
        </label>
        <label className="space-y-1.5 text-sm font-medium">
          Филиал
          <Select
            aria-label="Филиал для применения сценариев"
            onChange={(event) => changeFilter('branchId', event.target.value)}
            value={filters.branchId}
          >
            <option value="">Все филиалы</option>
            {branches.data?.map((branch) => (
              <option key={branch.id} value={branch.id}>
                {branch.name}
              </option>
            ))}
          </Select>
        </label>
        <label className="space-y-1.5 text-sm font-medium">
          Группа
          <Select
            aria-label="Группа для применения сценариев"
            onChange={(event) => changeFilter('groupId', event.target.value)}
            value={filters.groupId}
          >
            <option value="">Все группы</option>
            {visibleGroups.map((group) => (
              <option key={group.id} value={group.id}>
                {group.name}
              </option>
            ))}
          </Select>
        </label>
        <label className="space-y-1.5 text-sm font-medium md:col-span-2">
          Статус посещения
          <Select
            aria-label="Статус для применения сценариев"
            onChange={(event) => changeFilter('status', event.target.value)}
            value={filters.status}
          >
            <option value="">Все поддерживаемые статусы</option>
            {Object.entries(labels).map(([status, label]) => (
              <option key={status} value={status}>
                {label}
              </option>
            ))}
          </Select>
        </label>
      </div>

      <div className="mt-5 flex flex-wrap gap-3">
        <Button
          disabled={previewMutation.isPending || !filters.dateFrom || !filters.dateTo}
          onClick={() => previewMutation.mutate()}
          type="button"
        >
          {previewMutation.isPending ? <LoaderCircle className="size-4 animate-spin" /> : null}
          Предпросмотр
        </Button>
        {preview ? (
          <Button onClick={exportResult} type="button" variant="outline">
            <Download className="size-4" /> Экспорт результата
          </Button>
        ) : null}
      </div>

      {previewMutation.error ? (
        <p className="mt-4 text-sm text-red-600">{errorMessage(previewMutation.error)}</p>
      ) : null}

      {preview ? (
        <section className="mt-6 space-y-4" data-testid="attendance-reconciliation-preview">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-2xl bg-muted/60 p-3 text-sm">
              Затронуто занятий <strong>{preview.affectedLessonsCount}</strong>
            </div>
            <div className="rounded-2xl bg-muted/60 p-3 text-sm">
              Затронуто учеников <strong>{preview.affectedStudentsCount}</strong>
            </div>
            <div className="rounded-2xl bg-muted/60 p-3 text-sm">
              Списать <strong>{preview.totals.visitsToDeduct}</strong>
            </div>
            <div className="rounded-2xl bg-muted/60 p-3 text-sm">
              Вернуть <strong>{preview.totals.visitsToRestore}</strong>
            </div>
            <div className="rounded-2xl bg-muted/60 p-3 text-sm">
              Payroll: включить <strong>{preview.totals.payrollRowsToInclude}</strong>
            </div>
            <div className="rounded-2xl bg-muted/60 p-3 text-sm">
              Payroll: исключить <strong>{preview.totals.payrollRowsToExclude}</strong>
            </div>
            <div className="rounded-2xl bg-muted/60 p-3 text-sm">
              Пересчитать листов <strong>{preview.totals.payrollPeriodsToRecalculate}</strong>
            </div>
            <div className="rounded-2xl bg-muted/60 p-3 text-sm">
              Защищено <strong>{preview.totals.skippedProtectedRows}</strong>
            </div>
          </div>

          {preview.rows.length ? (
            <div className="overflow-x-auto rounded-2xl border border-border">
              <Table className="min-w-[1080px]">
                <TableHeader>
                  <TableRow>
                    <TableHead>Дата</TableHead>
                    <TableHead>Группа</TableHead>
                    <TableHead>Ученик</TableHead>
                    <TableHead>Статус</TableHead>
                    <TableHead>Абонемент сейчас</TableHead>
                    <TableHead>Абонемент после</TableHead>
                    <TableHead>Payroll сейчас</TableHead>
                    <TableHead>Payroll после</TableHead>
                    <TableHead>Комментарий</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {preview.rows.map((row) => (
                    <TableRow key={row.attendanceId}>
                      <TableCell>{formatDate(row.date)}</TableCell>
                      <TableCell>{row.groupName}</TableCell>
                      <TableCell>{row.studentName}</TableCell>
                      <TableCell>{labels[row.status]}</TableCell>
                      <TableCell>{subscriptionEffects[row.currentSubscriptionEffect]}</TableCell>
                      <TableCell>{subscriptionEffects[row.newSubscriptionEffect]}</TableCell>
                      <TableCell>{payrollEffects[row.currentPayrollEffect]}</TableCell>
                      <TableCell>{payrollEffects[row.newPayrollEffect]}</TableCell>
                      <TableCell className="max-w-64 whitespace-normal text-xs text-muted-foreground">
                        {row.skipReason ?? 'Будет применено'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <p className="rounded-2xl border border-border p-4 text-sm text-muted-foreground">
              Все найденные посещения уже соответствуют текущим сценариям.
            </p>
          )}

          {!result && preview.totals.actionableRows > 0 ? (
            <div className="rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
              <label className="flex items-start gap-3 font-medium">
                <Checkbox
                  aria-label="Подтвердить применение сценариев"
                  checked={confirmed}
                  onChange={(event) => setConfirmed(event.target.checked)}
                />
                Подтверждаю применение показанных списаний, возвратов и инвалидирование открытых
                расчётов зарплаты.
              </label>
              <Button
                className="mt-4"
                disabled={!confirmed || applyMutation.isPending}
                onClick={() => applyMutation.mutate()}
                type="button"
              >
                {applyMutation.isPending ? <LoaderCircle className="size-4 animate-spin" /> : null}
                Применить изменения
              </Button>
            </div>
          ) : null}

          {applyMutation.error ? (
            <p className="text-sm text-red-600">{errorMessage(applyMutation.error)}</p>
          ) : null}
          {result ? (
            <div className="rounded-2xl border border-emerald-300 bg-emerald-50 p-4 text-sm text-emerald-950">
              <p>Обработано {result.processedAttendanceCount} посещений</p>
              <p>Списано {result.deductedVisits}</p>
              <p>Возвращено {result.restoredVisits}</p>
              <p>Пересчётов зарплаты: {result.payrollPeriodsInvalidated}</p>
              <p>Пропущено защищённых: {result.protectedRowsSkipped}</p>
            </div>
          ) : null}
        </section>
      ) : null}
    </Dialog>
  );
}

export function AttendanceScenarioSettings() {
  const user = useAuthStore((state) => state.user);
  const canManage = user?.permissions.canManageSystemSettings ?? false;
  const [reconciliationOpen, setReconciliationOpen] = useState(false);
  const queryClient = useQueryClient();
  const queryKey = ['settings', 'attendance-scenarios'];
  const scenarios = useQuery({
    enabled: user?.role !== 'COACH',
    queryFn: () => getDesktopApi().attendance.listScenarios(getSessionToken()),
    queryKey,
  });
  const update = useMutation({
    mutationFn: (scenario: AttendanceScenarioSummary) =>
      getDesktopApi().attendance.updateScenario(getSessionToken(), scenario.status, {
        deductSubscription: scenario.deductSubscription,
        includeInTrainerPayroll: scenario.includeInTrainerPayroll,
      }),
    onSuccess: (saved) => {
      queryClient.setQueryData<AttendanceScenarioSummary[]>(queryKey, (current = []) =>
        current.map((item) => (item.status === saved.status ? saved : item)),
      );
    },
  });
  const change = (
    scenario: AttendanceScenarioSummary,
    field: 'deductSubscription' | 'includeInTrainerPayroll',
  ) => update.mutate({ ...scenario, [field]: !scenario[field] });

  return (
    <Card id="attendance-scenarios">
      <CardHeader>
        <CardTitle>Сценарии посещаемости</CardTitle>
        <p className="text-sm text-muted-foreground">
          Управляют списанием занятия с абонемента и количеством учеников в расчёте тренера.
          Изменения применяются к новым отметкам и новым расчётам.
        </p>
        {canManage ? (
          <div className="pt-2">
            <Button onClick={() => setReconciliationOpen(true)} type="button" variant="outline">
              <History className="size-4" /> Применить к прошлым занятиям
            </Button>
          </div>
        ) : null}
      </CardHeader>
      <CardContent>
        <div className="overflow-hidden rounded-2xl border border-border bg-background">
          <div className="grid grid-cols-[minmax(150px,1fr)_180px_180px] gap-3 border-b border-border bg-muted/40 px-4 py-3 text-xs font-semibold text-muted-foreground">
            <span>Статус</span>
            <span>Списывать с абонемента</span>
            <span>Начислять тренеру</span>
          </div>
          {scenarios.data?.map((scenario) => (
            <div
              className="grid grid-cols-[minmax(150px,1fr)_180px_180px] items-center gap-3 border-b border-border px-4 py-3 last:border-b-0"
              key={scenario.status}
            >
              <span className="text-sm font-semibold">{labels[scenario.status]}</span>
              <ScenarioToggle
                checked={scenario.deductSubscription}
                disabled={!canManage || update.isPending}
                label={`${labels[scenario.status]}: списывать с абонемента`}
                onChange={() => change(scenario, 'deductSubscription')}
              />
              <ScenarioToggle
                checked={scenario.includeInTrainerPayroll}
                disabled={!canManage || update.isPending}
                label={`${labels[scenario.status]}: начислять тренеру`}
                onChange={() => change(scenario, 'includeInTrainerPayroll')}
              />
            </div>
          ))}
          {scenarios.isLoading ? (
            <div className="flex items-center gap-2 px-4 py-5 text-sm text-muted-foreground">
              <LoaderCircle className="size-4 animate-spin" /> Загрузка настроек…
            </div>
          ) : null}
        </div>
        {!canManage ? (
          <p className="mt-3 text-xs text-muted-foreground">
            Только владелец может изменять эти настройки.
          </p>
        ) : null}
        {update.error instanceof Error ? (
          <p className="mt-3 text-sm text-red-600">{update.error.message}</p>
        ) : null}
      </CardContent>
      <ReconciliationDialog
        onClose={() => setReconciliationOpen(false)}
        open={reconciliationOpen}
      />
    </Card>
  );
}
