import type { AttendanceScenarioStatus, AttendanceScenarioSummary } from '@arava/shared';
import { Button, Card, CardContent, CardHeader, CardTitle, cn } from '@arava/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { LoaderCircle } from 'lucide-react';

import { getDesktopApi } from '../../lib/desktop-api';
import { getSessionToken, useAuthStore } from '../../stores/auth-store';

const labels: Record<AttendanceScenarioStatus, string> = {
  ABSENT: 'Отсутствовал',
  ILL: 'Болел',
  LATE: 'Опоздал',
  PRESENT: 'Присутствовал',
};

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

export function AttendanceScenarioSettings() {
  const user = useAuthStore((state) => state.user);
  const canManage = user?.permissions.canManageSystemSettings ?? false;
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
    </Card>
  );
}
