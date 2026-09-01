import {
  PAYOUT_CATEGORIES,
  type PayoutCalculationMode,
  type PayoutCategory,
  type TrainerPayoutRuleVersion,
} from '@arava/shared';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Dialog,
  Input,
  Label,
  Money,
  Select,
} from '@arava/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CircleAlert, Settings2 } from 'lucide-react';
import { useEffect, useState } from 'react';

import { getDesktopApi } from '../../lib/desktop-api';
import { getErrorMessage } from '../../lib/errors';
import { getSessionToken } from '../../stores/auth-store';

const categoryLabels: Record<PayoutCategory, string> = {
  MAKEUP: 'Отработка',
  PERSONAL_LESSON: 'Персональное занятие',
  PROMOTIONAL_FREE: 'Промо / бесплатное занятие',
  REGULAR_ATTENDANCE: 'Обычное посещение',
  SINGLE_VISIT: 'Разовое посещение',
  SUBSTITUTION: 'Замена',
  TRIAL: 'Пробное занятие',
};

const modeLabels: Record<PayoutCalculationMode, string> = {
  FIXED_PER_ATTENDANCE: 'Фиксировано за посещение',
  FIXED_PER_LESSON: 'Фиксировано за занятие',
  NO_PAYOUT: 'Без выплаты',
  PERCENTAGE: 'Процент',
};

interface EditableRule {
  mode: PayoutCalculationMode | '';
  value: string;
}

function todayInput(): string {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

function editable(version?: TrainerPayoutRuleVersion): EditableRule {
  return {
    mode: version?.mode ?? '',
    value:
      version?.mode === 'PERCENTAGE'
        ? String(version.percentage ?? '')
        : version?.amount === undefined
          ? ''
          : String(version.amount / 100),
  };
}

function hasInvalidValue(rule: EditableRule): boolean {
  if (
    rule.mode !== 'FIXED_PER_ATTENDANCE' &&
    rule.mode !== 'FIXED_PER_LESSON' &&
    rule.mode !== 'PERCENTAGE'
  )
    return false;
  if (!rule.value.trim()) return true;
  const value = Number(rule.value.replace(',', '.'));
  if (!Number.isFinite(value)) return true;
  return rule.mode === 'PERCENTAGE' ? value < 0.01 || value > 100 : value < 0;
}

function ruleLabel(version?: TrainerPayoutRuleVersion): React.ReactNode {
  if (!version?.mode) return <span className="text-amber-700">Не настроено</span>;
  if (version.mode === 'NO_PAYOUT') return modeLabels.NO_PAYOUT;
  if (version.mode === 'PERCENTAGE')
    return `${String(version.percentage ?? 0).replace('.', ',')}% от выручки`;
  return (
    <span className="inline-flex items-center gap-1.5">
      {modeLabels[version.mode]} · <Money amount={version.amount ?? 0} />
    </span>
  );
}

export function TrainerPayoutProfileCard({ trainerId }: { trainerId: string }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [effectiveFrom, setEffectiveFrom] = useState(todayInput);
  const [rules, setRules] = useState<Record<PayoutCategory, EditableRule>>(
    Object.fromEntries(PAYOUT_CATEGORIES.map((category) => [category, editable()])) as Record<
      PayoutCategory,
      EditableRule
    >,
  );
  const profile = useQuery({
    queryFn: () => getDesktopApi().payroll.getTrainerPayoutProfile(getSessionToken(), trainerId),
    queryKey: ['trainer-payout-profile', trainerId],
  });
  useEffect(() => {
    if (!open || !profile.data) return;
    setEffectiveFrom(todayInput());
    setRules(
      Object.fromEntries(
        profile.data.categories.map(({ category, current }) => [category, editable(current)]),
      ) as Record<PayoutCategory, EditableRule>,
    );
  }, [open, profile.data]);
  const save = useMutation({
    mutationFn: () =>
      getDesktopApi().payroll.saveTrainerPayoutProfile(getSessionToken(), {
        effectiveFrom,
        rules: PAYOUT_CATEGORIES.map((category) => {
          const rule = rules[category];
          const normalized = Number(rule.value.replace(',', '.'));
          return {
            category,
            ...(rule.mode ? { mode: rule.mode } : {}),
            ...(rule.mode === 'FIXED_PER_ATTENDANCE' || rule.mode === 'FIXED_PER_LESSON'
              ? { amount: Math.round(normalized * 100) }
              : {}),
            ...(rule.mode === 'PERCENTAGE' ? { percentage: normalized } : {}),
          };
        }),
        trainerId,
      }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['trainer-payout-profile', trainerId] }),
        queryClient.invalidateQueries({ queryKey: ['payroll'] }),
        queryClient.invalidateQueries({ queryKey: ['trainers', 'profile', trainerId] }),
      ]);
      setOpen(false);
    },
  });

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-3">
        <div>
          <CardTitle>Выплаты тренеру</CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">
            Правило выбирается по дате занятия. Скрытых ставок нет.
          </p>
        </div>
        {profile.data?.canEdit ? (
          <Button onClick={() => setOpen(true)} variant="outline">
            <Settings2 className="size-4" /> Настроить
          </Button>
        ) : null}
      </CardHeader>
      <CardContent>
        {profile.isLoading ? (
          <p className="text-sm text-muted-foreground">Загружаем правила…</p>
        ) : profile.isError || !profile.data ? (
          <p className="text-sm text-red-600">Не удалось загрузить правила выплат.</p>
        ) : (
          <div className="space-y-2">
            {profile.data.categories.map(({ category, current, future }) => (
              <div
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border px-4 py-3"
                key={category}
              >
                <div>
                  <p className="text-sm font-semibold">{categoryLabels[category]}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{ruleLabel(current)}</p>
                </div>
                {future.length ? (
                  <div className="flex flex-wrap justify-end gap-2">
                    {future.map((version) => (
                      <Badge key={version.id}>
                        С {version.effectiveFrom}: {ruleLabel(version)}
                      </Badge>
                    ))}
                  </div>
                ) : null}
              </div>
            ))}
            {profile.data.legacyRuleCount > 0 &&
            profile.data.categories.every(({ current }) => !current) ? (
              <div className="flex items-start gap-2 rounded-xl bg-blue-50 p-3 text-sm text-blue-900">
                <CircleAlert className="mt-0.5 size-4 shrink-0" />
                До сохранения нового профиля расчёт продолжает использовать прежние правила зарплаты
                ({profile.data.legacyRuleCount}).
              </div>
            ) : null}
          </div>
        )}
      </CardContent>
      <Dialog
        closeLabel="Закрыть"
        description="Новая версия применяется к занятиям с выбранной даты. Пустое правило сохраняется как «Не настроено»."
        onClose={() => setOpen(false)}
        open={open}
        title="Выплаты тренеру"
        wide
      >
        <div className="max-h-[65vh] space-y-4 overflow-y-auto pr-1">
          <Label className="block">
            Дата начала действия
            <Input
              className="mt-2 max-w-56"
              onChange={(event) => setEffectiveFrom(event.target.value)}
              type="date"
              value={effectiveFrom}
            />
          </Label>
          <div className="space-y-2">
            {PAYOUT_CATEGORIES.map((category) => {
              const rule = rules[category];
              const needsValue =
                rule.mode === 'FIXED_PER_ATTENDANCE' ||
                rule.mode === 'FIXED_PER_LESSON' ||
                rule.mode === 'PERCENTAGE';
              return (
                <div
                  className="grid gap-3 rounded-xl border border-border p-3 md:grid-cols-[minmax(180px,1fr)_minmax(220px,1fr)_150px] md:items-end"
                  key={category}
                >
                  <div>
                    <p className="text-sm font-semibold">{categoryLabels[category]}</p>
                  </div>
                  <Label>
                    Расчёт
                    <Select
                      className="mt-1"
                      onChange={(event) =>
                        setRules((current) => ({
                          ...current,
                          [category]: {
                            mode: event.target.value as PayoutCalculationMode | '',
                            value: '',
                          },
                        }))
                      }
                      value={rule.mode}
                    >
                      <option value="">Не настроено</option>
                      <option value="NO_PAYOUT">Без выплаты</option>
                      <option value="FIXED_PER_ATTENDANCE">За посещение</option>
                      <option value="FIXED_PER_LESSON">За занятие</option>
                      <option value="PERCENTAGE">Процент</option>
                    </Select>
                  </Label>
                  {needsValue ? (
                    <Label>
                      {rule.mode === 'PERCENTAGE' ? 'Процент' : 'Сумма, ₽'}
                      <Input
                        className="mt-1"
                        min={rule.mode === 'PERCENTAGE' ? 0.01 : 0}
                        onChange={(event) =>
                          setRules((current) => ({
                            ...current,
                            [category]: { ...current[category], value: event.target.value },
                          }))
                        }
                        required
                        step={rule.mode === 'PERCENTAGE' ? 0.01 : 0.01}
                        type="number"
                        value={rule.value}
                      />
                    </Label>
                  ) : (
                    <span />
                  )}
                </div>
              );
            })}
          </div>
          {save.isError ? (
            <p className="text-sm text-red-600">
              {getErrorMessage(save.error, 'Не удалось сохранить правила выплат.')}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button onClick={() => setOpen(false)} variant="outline">
              Отмена
            </Button>
            <Button
              disabled={
                save.isPending ||
                !effectiveFrom ||
                PAYOUT_CATEGORIES.some((category) => hasInvalidValue(rules[category]))
              }
              onClick={() => void save.mutateAsync()}
            >
              {save.isPending ? 'Сохраняем…' : 'Сохранить версию'}
            </Button>
          </div>
        </div>
      </Dialog>
    </Card>
  );
}
