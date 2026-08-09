import { formatDate, type MembershipCardStatus } from '@arava/shared';
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
  Select,
} from '@arava/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, CreditCard, Link2, RefreshCw, ScanLine, Unlink } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';

import { getDesktopApi } from '../../lib/desktop-api';
import { getErrorMessage } from '../../lib/errors';
import { getSessionToken, useAuthStore } from '../../stores/auth-store';

const labels: Record<MembershipCardStatus, string> = {
  ARCHIVED: 'В архиве',
  ASSIGNED: 'Привязана',
  BLOCKED: 'Заблокирована',
  FREE: 'Свободна',
  LOST: 'Утеряна',
};

export function StudentCard({ studentId }: { studentId: string }) {
  const user = useAuthStore((state) => state.user);
  const canManage = user?.role === 'OWNER' || user?.role === 'ADMIN';
  const queryClient = useQueryClient();
  const [dialog, setDialog] = useState<'assign' | 'replace'>();
  const [barcode, setBarcode] = useState('');
  const [replacementStatus, setReplacementStatus] = useState<'BLOCKED' | 'LOST'>('LOST');
  const [error, setError] = useState<string>();
  const card = useQuery({
    queryFn: () => getDesktopApi().cards.studentCurrent(getSessionToken(), studentId),
    queryKey: ['cards', 'student-current', studentId],
  });
  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ['cards'] });
  };
  const save = useMutation({
    mutationFn: async () => {
      if (dialog === 'replace' && card.data)
        return getDesktopApi().cards.replace(getSessionToken(), {
          newBarcode: barcode.trim(),
          oldCardId: card.data.id,
          oldCardStatus: replacementStatus,
          registerIfUnknown: true,
          studentId,
        });
      return getDesktopApi().cards.assign(getSessionToken(), {
        barcode: barcode.trim(),
        registerIfUnknown: true,
        studentId,
      });
    },
    onSuccess: async () => {
      await refresh();
      setDialog(undefined);
      setBarcode('');
    },
  });
  const action = useMutation({
    mutationFn: async (kind: 'block' | 'lost' | 'reactivate' | 'unassign') => {
      if (!card.data) throw new Error('Карта не найдена.');
      if (kind === 'block') return getDesktopApi().cards.block(getSessionToken(), card.data.id, {});
      if (kind === 'lost')
        return getDesktopApi().cards.markLost(getSessionToken(), card.data.id, {});
      if (kind === 'reactivate')
        return getDesktopApi().cards.reactivate(getSessionToken(), card.data.id, {});
      return getDesktopApi().cards.unassign(getSessionToken(), card.data.id, {});
    },
    onSuccess: refresh,
  });
  const perform = async (kind: 'block' | 'lost' | 'reactivate' | 'unassign', text: string) => {
    if (!window.confirm(text)) return;
    setError(undefined);
    try {
      await action.mutateAsync(kind);
    } catch (caught) {
      setError(getErrorMessage(caught, 'Не удалось изменить карту.'));
    }
  };

  return (
    <Card className="mt-5">
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <div>
          <CardTitle>Пластиковая карта</CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">Заранее напечатанная карта клиента</p>
        </div>
        {card.data ? <Badge>{labels[card.data.status]}</Badge> : null}
      </CardHeader>
      <CardContent>
        {card.isLoading ? <p className="text-sm text-muted-foreground">Проверяем карту…</p> : null}
        {!card.isLoading && !card.data ? (
          <div className="flex items-center justify-between rounded-2xl border border-dashed border-border p-5">
            <div className="flex items-center gap-3">
              <span className="flex size-11 items-center justify-center rounded-xl bg-muted">
                <CreditCard className="size-5" />
              </span>
              <div>
                <p className="font-semibold">Карта не привязана</p>
                <p className="text-sm text-muted-foreground">
                  Отсканируйте свободную карту или зарегистрируйте новую.
                </p>
              </div>
            </div>
            {canManage ? (
              <Button
                onClick={() => {
                  setError(undefined);
                  setDialog('assign');
                }}
              >
                <Link2 className="size-4" /> Привязать карту
              </Button>
            ) : null}
          </div>
        ) : null}
        {card.data ? (
          <div className="rounded-2xl border border-border bg-background p-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Штрихкод
                </p>
                <p className="mt-2 font-mono text-xl font-semibold tracking-widest">
                  {card.data.barcode}
                </p>
                <p className="mt-2 text-sm text-muted-foreground">
                  Выдана: {card.data.issuedAt ? formatDate(card.data.issuedAt) : 'дата не указана'}
                </p>
              </div>
              {canManage ? (
                <div className="flex flex-wrap justify-end gap-2">
                  {card.data.status === 'ASSIGNED' ? (
                    <>
                      <Button
                        onClick={() => {
                          setError(undefined);
                          setDialog('replace');
                        }}
                        variant="outline"
                      >
                        <RefreshCw className="size-4" /> Заменить карту
                      </Button>
                      <Button
                        onClick={() => void perform('lost', 'Отметить карту как утерянную?')}
                        variant="outline"
                      >
                        <ScanLine className="size-4" /> Карта утеряна
                      </Button>
                      <Button
                        onClick={() => void perform('block', 'Заблокировать карту?')}
                        variant="outline"
                      >
                        <Ban className="size-4" /> Заблокировать
                      </Button>
                      <Button
                        onClick={() => void perform('unassign', 'Отвязать карту от клиента?')}
                        variant="outline"
                      >
                        <Unlink className="size-4" /> Отвязать карту
                      </Button>
                    </>
                  ) : null}
                  {card.data.status === 'BLOCKED' || card.data.status === 'LOST' ? (
                    <>
                      <Button
                        onClick={() => {
                          setError(undefined);
                          setDialog('assign');
                        }}
                      >
                        <Link2 className="size-4" /> Привязать новую карту
                      </Button>
                      <Button
                        onClick={() => void perform('reactivate', 'Разблокировать эту карту?')}
                        variant="outline"
                      >
                        <RefreshCw className="size-4" /> Разблокировать
                      </Button>
                    </>
                  ) : null}
                </div>
              ) : null}
            </div>
            <Link
              className="mt-4 inline-flex text-sm font-semibold text-muted-foreground hover:text-foreground"
              to={`/cards?barcode=${encodeURIComponent(card.data.barcode)}`}
            >
              Открыть карту и историю →
            </Link>
          </div>
        ) : null}
        {error ? <p className="mt-3 text-sm text-red-600">{error}</p> : null}
      </CardContent>
      <Dialog
        closeLabel="Закрыть"
        description="Отсканируйте физическую карту или введите штрихкод вручную. Неизвестная карта будет зарегистрирована автоматически."
        footer={
          <div className="flex justify-end gap-2">
            <Button onClick={() => setDialog(undefined)} variant="outline">
              Отмена
            </Button>
            <Button
              disabled={save.isPending || barcode.trim().length < 4}
              onClick={async () => {
                setError(undefined);
                try {
                  await save.mutateAsync();
                } catch (caught) {
                  setError(getErrorMessage(caught, 'Не удалось сохранить карту.'));
                }
              }}
            >
              {dialog === 'replace' ? 'Заменить карту' : 'Привязать карту'}
            </Button>
          </div>
        }
        onClose={() => setDialog(undefined)}
        open={Boolean(dialog)}
        title={dialog === 'replace' ? 'Замена пластиковой карты' : 'Привязка пластиковой карты'}
      >
        <div className="space-y-4">
          <div>
            <Label htmlFor="student-card-barcode">Штрихкод новой карты</Label>
            <Input
              autoFocus
              id="student-card-barcode"
              onChange={(event) => setBarcode(event.target.value)}
              placeholder="0000001001"
              value={barcode}
            />
          </div>
          {dialog === 'replace' ? (
            <div>
              <Label htmlFor="replacement-reason">Состояние старой карты</Label>
              <Select
                id="replacement-reason"
                onChange={(event) => setReplacementStatus(event.target.value as 'BLOCKED' | 'LOST')}
                value={replacementStatus}
              >
                <option value="LOST">Утеряна</option>
                <option value="BLOCKED">Заблокирована</option>
              </Select>
            </div>
          ) : null}
          {error ? <p className="text-sm text-red-600">{error}</p> : null}
        </div>
      </Dialog>
    </Card>
  );
}
