import {
  passwordSchema,
  type EmergencyOwnerPreview,
  type EmergencyOwnerResult,
} from '@arava/shared';
import { Button, Card, CardContent, Input, Label } from '@arava/ui';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import { BrandMark } from '../../components/brand-mark';
import { getDesktopApi } from '../../lib/desktop-api';

const CONFIRMATION = 'ВОССТАНОВИТЬ ВЛАДЕЛЬЦА';

export function EmergencyOwnerRecoveryPage() {
  const [available, setAvailable] = useState<boolean>();
  const [preview, setPreview] = useState<EmergencyOwnerPreview>();
  const [authorized, setAuthorized] = useState(false);
  const [result, setResult] = useState<EmergencyOwnerResult>();
  const [newPassword, setNewPassword] = useState('');
  const [repeatPassword, setRepeatPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    void getDesktopApi()
      .auth.emergencyAvailable()
      .then(setAvailable)
      .catch(() => setAvailable(false));
  }, []);

  const prepare = async () => {
    setBusy(true);
    setError(undefined);
    try {
      setPreview(await getDesktopApi().auth.emergencyPrepare());
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Проверка не выполнена.');
    } finally {
      setBusy(false);
    }
  };

  const authorize = async () => {
    if (!preview) return;
    setBusy(true);
    setError(undefined);
    try {
      await getDesktopApi().auth.emergencyAuthorize(preview.ticket);
      setAuthorized(true);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Подтверждение UAC не получено.');
    } finally {
      setBusy(false);
    }
  };

  const reset = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!preview || !authorized) return;
    setError(undefined);
    if (newPassword !== repeatPassword) {
      setError('Пароли не совпадают.');
      return;
    }
    if (!passwordSchema.safeParse(newPassword).success) {
      setError('Новый пароль не соответствует требованиям безопасности.');
      return;
    }
    setBusy(true);
    try {
      setResult(
        await getDesktopApi().auth.emergencyReset(preview.ticket, newPassword, confirmation),
      );
      setNewPassword('');
      setRepeatPassword('');
      setConfirmation('');
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Пароль не изменён.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="app-no-drag h-screen overflow-y-auto bg-background px-4 py-6 sm:px-6">
      <div className="mx-auto w-full max-w-2xl">
        <BrandMark className="mb-6 text-foreground" />
        <Card className="rounded-3xl">
          <CardContent className="space-y-5 p-8">
            <h1 className="text-2xl font-semibold">Аварийное восстановление владельца</h1>
            <p className="text-sm text-muted-foreground">
              Только для существующего OWNER на этом компьютере. Потребуются резервная копия и
              подтверждение администратора Windows. Данные студии и ошибки синхронизации не
              удаляются.
            </p>
            {available === false ? <p>Эта одноразовая функция здесь недоступна.</p> : null}
            {available && !preview ? (
              <Button disabled={busy} onClick={() => void prepare()}>
                {busy ? 'Проверяем базу…' : 'Проверить базу и создать копию'}
              </Button>
            ) : null}
            {preview && !result ? (
              <section className="space-y-3 rounded-xl border p-4 text-sm">
                <p className="font-semibold">Проверка пройдена. Копия создана и проверена.</p>
                <p>
                  Владелец: {preview.ownerName} · {preview.ownerEmail}
                </p>
                <p>OWNER ID: {preview.ownerId}</p>
                <p className="break-all">Копия: {preview.backupPath}</p>
                <p>
                  SyncOutbox: {preview.outbox}; постоянных FAILED: {preview.failed}
                </p>
                {preview.syncLogChanged !== 0 ? (
                  <p>SyncLog changed: expected volatile background activity.</p>
                ) : null}
                <p>
                  Подготовка действует до {new Date(preview.expiresAt).toLocaleString('ru-RU')}.
                </p>
                {!authorized ? (
                  <Button disabled={busy} onClick={() => void authorize()} variant="outline">
                    {busy ? 'Ожидаем UAC…' : 'Подтвердить через администратора Windows'}
                  </Button>
                ) : null}
              </section>
            ) : null}
            {preview && authorized && !result ? (
              <form className="space-y-3" onSubmit={(event) => void reset(event)}>
                <p className="text-sm font-semibold">
                  Введите новый пароль только на этом компьютере.
                </p>
                <Label htmlFor="emergency-password">Новый пароль</Label>
                <Input
                  id="emergency-password"
                  type="password"
                  autoComplete="new-password"
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.target.value)}
                />
                <Label htmlFor="emergency-repeat">Повторите пароль</Label>
                <Input
                  id="emergency-repeat"
                  type="password"
                  autoComplete="new-password"
                  value={repeatPassword}
                  onChange={(event) => setRepeatPassword(event.target.value)}
                />
                <Label htmlFor="emergency-confirm">Для подтверждения введите: {CONFIRMATION}</Label>
                <Input
                  id="emergency-confirm"
                  value={confirmation}
                  onChange={(event) => setConfirmation(event.target.value)}
                />
                <Button disabled={busy || confirmation !== CONFIRMATION} type="submit">
                  {busy ? 'Восстанавливаем…' : 'Изменить пароль существующего OWNER'}
                </Button>
              </form>
            ) : null}
            {result ? (
              <section className="space-y-3 rounded-xl border border-green-300 p-4">
                <p className="font-semibold">
                  Доступ восстановлен. Сохраните новый код восстановления офлайн: он больше не
                  появится.
                </p>
                <code className="block select-all break-all text-lg">{result.recoveryCode}</code>
                <p className="text-sm">
                  FAILED до/после: {result.failedBefore}/{result.failedAfter}. Войдите с новым
                  паролем.
                </p>
                {result.syncLogChanged !== 0 ? (
                  <p className="text-sm">SyncLog changed: expected volatile background activity.</p>
                ) : null}
              </section>
            ) : null}
            {error ? (
              <p className="text-sm text-red-600" role="alert">
                {error}
              </p>
            ) : null}
            <Link className="block text-sm font-medium underline" to="/login">
              Вернуться ко входу
            </Link>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
