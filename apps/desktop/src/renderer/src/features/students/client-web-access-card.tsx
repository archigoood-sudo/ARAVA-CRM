import {
  type ClientWebAccessResult,
  type ClientWebAccessStatus,
  formatDate,
  type StudentDetail,
} from '@arava/shared';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Dialog,
  Label,
  Select,
} from '@arava/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Clipboard, Globe2, RefreshCw, ShieldOff } from 'lucide-react';
import { useMemo, useState } from 'react';

import { getDesktopApi } from '../../lib/desktop-api';
import { getErrorMessage } from '../../lib/errors';
import { getSessionToken, useAuthStore } from '../../stores/auth-store';

interface PhoneOption {
  displayName: string;
  label: string;
  phone: string;
}

const statusLabels: Record<ClientWebAccessStatus['state'], string> = {
  ACTIVE: 'Аккаунт активирован',
  EXISTING_ACCOUNT: 'Найден существующий аккаунт',
  INVITED: 'Приглашение создано · ожидает первого входа',
  NOT_ISSUED: 'Доступ не выдан',
  REVOKED: 'Доступ отозван',
};

export function ClientWebAccessCard({ student }: { student: StudentDetail }) {
  const user = useAuthStore((state) => state.user);
  const queryClient = useQueryClient();
  const [issueOpen, setIssueOpen] = useState(false);
  const [selectedPhone, setSelectedPhone] = useState('');
  const [temporary, setTemporary] = useState<ClientWebAccessResult>();
  const [error, setError] = useState<string>();
  const phones = useMemo(() => phoneOptions(student), [student]);
  const queryKey = ['client-web-access', user?.id, student.id, phones.map(({ phone }) => phone)];
  const status = useQuery({
    enabled: Boolean(user && user.role !== 'COACH'),
    queryFn: () =>
      getDesktopApi().clientAccess.status(
        getSessionToken(),
        student.id,
        phones.map(({ phone }) => phone),
      ),
    queryKey,
    retry: false,
  });
  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ['client-web-access', user?.id, student.id] });
  };
  const issue = useMutation({
    mutationFn: (option: PhoneOption) =>
      getDesktopApi().clientAccess.issue(getSessionToken(), student.id, {
        displayName: option.displayName,
        phone: option.phone,
      }),
  });
  const reissue = useMutation({
    mutationFn: () => getDesktopApi().clientAccess.reissue(getSessionToken(), student.id),
  });
  const link = useMutation({
    mutationFn: (accountId: string) =>
      getDesktopApi().clientAccess.link(getSessionToken(), student.id, accountId),
  });
  const revoke = useMutation({
    mutationFn: () => getDesktopApi().clientAccess.revoke(getSessionToken(), student.id),
  });
  const showTemporaryCode = async (result: ClientWebAccessResult) => {
    await refresh();
    if (result.temporaryCode) setTemporary(result);
  };
  const submitIssue = async () => {
    const option = phones.find(({ phone }) => phone === selectedPhone);
    if (!option) return;
    setError(undefined);
    try {
      const result = await issue.mutateAsync(option);
      setIssueOpen(false);
      await showTemporaryCode(result);
    } catch (caught) {
      setError(getErrorMessage(caught, 'Не удалось выдать доступ к личному кабинету.'));
    }
  };
  const submitReissue = async () => {
    setError(undefined);
    try {
      await showTemporaryCode(await reissue.mutateAsync());
    } catch (caught) {
      setError(getErrorMessage(caught, 'Не удалось выдать новый временный код.'));
    }
  };
  const submitLink = async (current: ClientWebAccessStatus) => {
    if (
      !current.accountId ||
      !window.confirm(`Связать найденный WEB-аккаунт ${current.maskedPhone ?? ''} с этим учеником?`)
    )
      return;
    setError(undefined);
    try {
      await link.mutateAsync(current.accountId);
      await refresh();
    } catch (caught) {
      setError(getErrorMessage(caught, 'Не удалось связать аккаунт.'));
    }
  };
  const submitRevoke = async () => {
    if (!window.confirm('Отозвать доступ к личному кабинету?')) return;
    setError(undefined);
    try {
      await revoke.mutateAsync();
      await refresh();
    } catch (caught) {
      setError(getErrorMessage(caught, 'Не удалось отозвать доступ.'));
    }
  };
  const current = status.data;
  const busy = issue.isPending || reissue.isPending || link.isPending || revoke.isPending;
  return (
    <>
      <Card className="mt-5" data-testid="client-web-access" id="client-web-access">
        <CardHeader className="flex-row items-start justify-between gap-4 space-y-0">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Globe2 className="size-5" /> Личный кабинет
            </CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              Доступ ученика или родителя к ARAVA-WEB
            </p>
          </div>
          <Button
            aria-label="Обновить статус личного кабинета"
            disabled={status.isFetching}
            onClick={() => void status.refetch()}
            size="icon"
            variant="ghost"
          >
            <RefreshCw className={status.isFetching ? 'size-4 animate-spin' : 'size-4'} />
          </Button>
        </CardHeader>
        <CardContent>
          {status.isLoading ? (
            <p className="text-sm text-muted-foreground">Проверяем доступ…</p>
          ) : status.isError ? (
            <div className="space-y-3">
              <p className="text-sm text-red-600">
                Не удалось проверить личный кабинет. Проверьте подключение к сайту.
              </p>
              <Button onClick={() => void status.refetch()} size="small" variant="outline">
                Повторить
              </Button>
            </div>
          ) : current ? (
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <Badge>{statusLabels[current.state]}</Badge>
                {current.maskedPhone ? (
                  <p className="mt-2 text-sm text-muted-foreground">
                    Телефон: {current.maskedPhone}
                  </p>
                ) : null}
                {current.lastLoginAt ? (
                  <p className="mt-1 text-xs text-muted-foreground">
                    Последний вход:{' '}
                    {formatDate(current.lastLoginAt, {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                    })}
                  </p>
                ) : null}
                {current.recoveryRequestId ? (
                  <p className="mt-1 text-xs text-amber-700">
                    Есть запрос на восстановление доступа
                  </p>
                ) : null}
              </div>
              <div className="flex flex-wrap gap-2">
                {current.state === 'NOT_ISSUED' ? (
                  <Button
                    disabled={!phones.length}
                    onClick={() => {
                      setError(undefined);
                      setSelectedPhone(phones.length === 1 ? (phones[0]?.phone ?? '') : '');
                      setIssueOpen(true);
                    }}
                  >
                    Выдать доступ
                  </Button>
                ) : null}
                {current.canLink ? (
                  <Button disabled={busy} onClick={() => void submitLink(current)}>
                    <Check className="size-4" /> Связать аккаунт
                  </Button>
                ) : null}
                {current.canReissue ? (
                  <Button disabled={busy} onClick={() => void submitReissue()} variant="outline">
                    Выдать новый временный код
                  </Button>
                ) : null}
                {current.canRevoke || current.state === 'INVITED' ? (
                  <Button disabled={busy} onClick={() => void submitRevoke()} variant="outline">
                    <ShieldOff className="size-4" /> Отозвать доступ
                  </Button>
                ) : null}
              </div>
            </div>
          ) : null}
          {!phones.length && current?.state === 'NOT_ISSUED' ? (
            <p className="mt-3 text-sm text-amber-700">
              Сначала добавьте телефон ученика или контактного лица.
            </p>
          ) : null}
          {error ? <p className="mt-3 text-sm text-red-600">{error}</p> : null}
        </CardContent>
      </Card>

      <Dialog
        closeLabel="Закрыть"
        description="Если номеров несколько, выберите владельца кабинета явно."
        footer={
          <div className="flex justify-end gap-2">
            <Button onClick={() => setIssueOpen(false)} variant="outline">
              Отмена
            </Button>
            <Button disabled={!selectedPhone || issue.isPending} onClick={() => void submitIssue()}>
              Выдать доступ
            </Button>
          </div>
        }
        onClose={() => setIssueOpen(false)}
        open={issueOpen}
        title="Выдать доступ к личному кабинету"
      >
        <div className="space-y-3">
          <Label htmlFor="client-web-access-phone">Телефон</Label>
          <Select
            id="client-web-access-phone"
            onChange={(event) => setSelectedPhone(event.target.value)}
            value={selectedPhone}
          >
            <option value="">Выберите телефон</option>
            {phones.map((option) => (
              <option key={`${option.phone}-${option.label}`} value={option.phone}>
                {option.label} · {option.phone}
              </option>
            ))}
          </Select>
          {error ? <p className="text-sm text-red-600">{error}</p> : null}
        </div>
      </Dialog>

      <Dialog
        closeLabel="Закрыть"
        description="Код показывается только сейчас. Передайте его владельцу кабинета безопасным способом."
        footer={
          <div className="flex justify-end gap-2">
            <Button
              onClick={() => {
                if (temporary?.temporaryCode)
                  void navigator.clipboard.writeText(temporary.temporaryCode);
              }}
              variant="outline"
            >
              <Clipboard className="size-4" /> Скопировать
            </Button>
            <Button onClick={() => setTemporary(undefined)}>Закрыть</Button>
          </div>
        }
        onClose={() => setTemporary(undefined)}
        open={Boolean(temporary?.temporaryCode)}
        title="Временный код"
      >
        <div className="rounded-2xl bg-neutral-950 p-6 text-center text-white">
          <p
            className="font-mono text-4xl font-semibold tracking-[0.25em]"
            data-testid="temporary-code"
          >
            {temporary?.temporaryCode}
          </p>
          {temporary?.codeExpiresAt ? (
            <p className="mt-3 text-xs text-neutral-400">
              Действует до {formatDate(temporary.codeExpiresAt, { timeStyle: 'short' })}
            </p>
          ) : null}
        </div>
        <p className="mt-4 text-sm text-muted-foreground">
          Первый вход: телефон и этот код. Затем клиент обязательно создаст постоянный пароль.
        </p>
      </Dialog>
    </>
  );
}

function phoneOptions(student: StudentDetail): PhoneOption[] {
  const options: PhoneOption[] = [];
  const seen = new Set<string>();
  const add = (phone: string | undefined, displayName: string, label: string) => {
    const value = phone?.trim();
    if (!value || seen.has(value)) return;
    seen.add(value);
    options.push({ displayName, label, phone: value });
  };
  const studentName = `${student.firstName} ${student.lastName}`.trim();
  add(student.phone, studentName, studentName);
  for (const contact of student.contacts) {
    add(contact.phone, contact.fullName, `${contact.fullName} · ${contact.relationship}`);
    add(contact.secondaryPhone, contact.fullName, `${contact.fullName} · дополнительный телефон`);
  }
  return options;
}
