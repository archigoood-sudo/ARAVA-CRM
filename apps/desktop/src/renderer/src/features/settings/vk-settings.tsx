import type { VkAction } from '@arava/shared';
import { Button, Card, CardContent, CardHeader, CardTitle, Input } from '@arava/ui';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';

import { getDesktopApi } from '../../lib/desktop-api';
import { getErrorMessage } from '../../lib/errors';
import { getSessionToken, useAuthStore } from '../../stores/auth-store';

export function VkSettings() {
  const userId = useAuthStore((state) => state.user?.id);
  const [open, setOpen] = useState(false);
  const [groupId, setGroupId] = useState('');
  const [token, setToken] = useState('');
  const [secret, setSecret] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [branchId, setBranchId] = useState('');
  const [disableConfirmed, setDisableConfirmed] = useState(false);
  const status = useQuery({
    queryKey: ['vk-settings', userId],
    enabled: open,
    retry: false,
    queryFn: () => getDesktopApi().vk.request(getSessionToken(), { action: 'STATUS' }),
  });
  const integration = useQuery({
    queryKey: ['vk-server-address', userId],
    enabled: open,
    queryFn: () => getDesktopApi().integration.getStatus(getSessionToken()),
  });
  const branches = useQuery({
    queryKey: ['vk-branches', userId],
    enabled: open,
    queryFn: () => getDesktopApi().branches.list(getSessionToken()),
  });
  const mutation = useMutation({
    mutationFn: (input: VkAction) => getDesktopApi().vk.request(getSessionToken(), input),
    onSuccess: () => {
      setToken('');
      setSecret('');
      setConfirmation('');
      setDisableConfirmed(false);
      void status.refetch();
    },
  });
  const settings = status.data?.settings;
  const callbackUrl = integration.data
    ? integration.data.baseUrl.replace(/\/+$/u, '') + '/api/integrations/vk/community'
    : '';
  return (
    <Card id="vk-integration">
      <CardHeader>
        <CardTitle>ВКонтакте: сообщения и заявки</CardTitle>
        <p className="text-sm text-muted-foreground">
          Сервер принимает обращения даже при выключенной CRM. Ключ сообщества вводится только
          здесь, не в переписке.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <Button variant="outline" onClick={() => setOpen(!open)}>
          {open ? 'Свернуть подключение ВК' : 'Настроить ВКонтакте'}
        </Button>
        {open ? (
          <>
            {status.isPending ? <p role="status">Проверяем подключение…</p> : null}
            {status.isError ? (
              <p role="alert" className="text-sm text-red-600">
                {getErrorMessage(status.error, 'Сначала подключите CRM к серверу с поддержкой ВК.')}
              </p>
            ) : null}
            {settings ? (
              <>
                <div className="space-y-1 text-sm">
                  <p>
                    {settings.configured
                      ? `${settings.groupName ?? 'Сообщество'} · ${settings.enabled ? 'приём включён' : 'приём выключен'}`
                      : 'Сообщество ещё не подключено'}
                  </p>
                  <p>Последнее событие: {settings.lastCallbackAt ?? 'ещё не поступало'}</p>
                  <p>Последняя отправка: {settings.lastSendAt ?? 'ещё не выполнялась'}</p>
                  <p>
                    Неподтверждённые отправки: {settings.uncertainMessages}. Отклонённые сообщения:{' '}
                    {settings.rejectedMessages}. Отклонённые события: {settings.rejectedEvents}.
                  </p>
                  {settings.lastError ? (
                    <p role="alert">Последняя ошибка ВК: {settings.lastError}</p>
                  ) : null}
                </div>
                <form
                  className="grid gap-3"
                  onSubmit={(event) => {
                    event.preventDefault();
                    mutation.mutate({
                      action: 'CONFIGURE',
                      groupId: Number(groupId || settings.groupId),
                      token,
                      callbackSecret: secret,
                      confirmation,
                      branchId: branchId || null,
                    });
                  }}
                >
                  <p className="text-sm text-muted-foreground">
                    В управлении сообществом включите сообщения. Создайте ключ сообщества с доступом
                    к сообщениям. В Callback API укажите адрес ниже, секрет и события message_new,
                    message_reply, lead_forms_new (API 5.199). Сначала сохраните настройки здесь,
                    затем подтвердите сервер в ВК. Для заявок форма должна передавать телефон.
                  </p>
                  <label className="text-sm">
                    Адрес Callback API
                    <Input readOnly value={callbackUrl} />
                  </label>
                  <label className="text-sm">
                    Числовой ID сообщества
                    <Input
                      required
                      inputMode="numeric"
                      value={groupId || (settings.groupId === null ? '' : String(settings.groupId))}
                      onChange={(event) => setGroupId(event.target.value)}
                    />
                  </label>
                  <label className="text-sm">
                    Филиал для новых обращений
                    <select
                      className="mt-1 block w-full rounded-xl border border-border bg-background p-2"
                      value={branchId}
                      onChange={(event) => setBranchId(event.target.value)}
                    >
                      <option value="">
                        Без филиала: только владелец и администраторы всех филиалов
                      </option>
                      {branches.data?.map((branch) => (
                        <option key={branch.id} value={branch.id}>
                          {branch.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="text-sm">
                    Ключ доступа сообщества
                    <Input
                      type="password"
                      autoComplete="new-password"
                      required
                      minLength={16}
                      maxLength={2048}
                      value={token}
                      onChange={(event) => setToken(event.target.value)}
                    />
                  </label>
                  <label className="text-sm">
                    Секрет Callback API (не менее 32 символов)
                    <Input
                      type="password"
                      autoComplete="new-password"
                      required
                      minLength={32}
                      maxLength={256}
                      value={secret}
                      onChange={(event) => setSecret(event.target.value)}
                    />
                  </label>
                  <label className="text-sm">
                    Строка подтверждения сервера из ВК
                    <Input
                      required
                      maxLength={100}
                      value={confirmation}
                      onChange={(event) => setConfirmation(event.target.value)}
                    />
                  </label>
                  <p className="text-xs text-muted-foreground">
                    Изменение филиала применяется только к новым диалогам. Ключ хранится
                    зашифрованным на сервере и не попадает в очередь синхронизации CRM.
                  </p>
                  <Button className="w-fit" type="submit" disabled={mutation.isPending}>
                    Проверить и подключить сообщество
                  </Button>
                </form>
                {settings.enabled ? (
                  <div className="space-y-2 border-t border-border pt-3">
                    <label className="flex gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={disableConfirmed}
                        onChange={(event) => setDisableConfirmed(event.target.checked)}
                      />
                      Подтверждаю отключение приёма и отправки. История сохранится.
                    </label>
                    <Button
                      variant="outline"
                      disabled={!disableConfirmed || mutation.isPending}
                      onClick={() => mutation.mutate({ action: 'DISABLE' })}
                    >
                      Отключить ВКонтакте
                    </Button>
                  </div>
                ) : null}
              </>
            ) : null}
            {mutation.isError ? (
              <p role="alert" className="text-sm text-red-600">
                {getErrorMessage(mutation.error, 'Не удалось изменить подключение ВК.')}
              </p>
            ) : null}
            {mutation.isSuccess ? (
              <p role="status" className="text-sm">
                Настройки сохранены. Для первого подключения подтвердите Callback API в ВКонтакте.
              </p>
            ) : null}
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}
