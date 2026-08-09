import { ownerRecoverySchema, t, type OwnerRecoveryResult } from '@arava/shared';
import { Button, Card, CardContent, Input, Label } from '@arava/ui';
import { ArrowLeft, KeyRound, ShieldAlert } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';

import { BrandMark } from '../../components/brand-mark';
import { getDesktopApi } from '../../lib/desktop-api';

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [recoveryCode, setRecoveryCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [repeatPassword, setRepeatPassword] = useState('');
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<OwnerRecoveryResult>();

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(undefined);
    if (newPassword !== repeatPassword) {
      setError(t('validation.passwordsMatch'));
      return;
    }
    const parsed = ownerRecoverySchema.safeParse({ email, newPassword, recoveryCode });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? t('auth.recovery.error'));
      return;
    }
    setPending(true);
    try {
      setResult(await getDesktopApi().auth.recoverOwner(parsed.data));
    } catch {
      setError(t('auth.recovery.error'));
    } finally {
      setPending(false);
    }
  };

  return (
    <main className="app-drag-region flex min-h-screen items-center justify-center bg-background p-10">
      <div className="app-no-drag w-full max-w-xl">
        <BrandMark className="mb-8 text-foreground" />
        <Card className="rounded-3xl">
          <CardContent className="p-8">
            <span className="flex size-12 items-center justify-center rounded-2xl bg-accent text-neutral-950">
              <KeyRound className="size-5" />
            </span>
            <h1 className="mt-6 text-3xl font-semibold tracking-[-0.04em]">
              {t('auth.recovery.title')}
            </h1>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              {t('auth.recovery.description')}
            </p>
            <div className="mt-5 flex gap-3 rounded-2xl bg-surface p-4 text-sm leading-6 text-muted-foreground">
              <ShieldAlert className="mt-0.5 size-5 shrink-0 text-foreground" />
              {t('auth.recovery.staffHelp')}
            </div>
            {result ? (
              <div className="mt-7 space-y-4">
                <p className="font-semibold">{t('auth.recovery.success')}</p>
                <p className="text-sm text-muted-foreground">{t('auth.recovery.newCodeHint')}</p>
                <code className="block select-all rounded-2xl bg-sidebar p-4 text-center text-sm font-semibold tracking-wider text-accent">
                  {result.recoveryCode}
                </code>
                <Link
                  className="flex h-12 w-full items-center justify-center rounded-xl bg-foreground px-5 text-sm font-semibold text-background"
                  to="/login"
                >
                  {t('auth.recovery.backToLogin')}
                </Link>
              </div>
            ) : (
              <form className="mt-7 space-y-4" onSubmit={submit}>
                <div className="space-y-2">
                  <Label htmlFor="recovery-email">{t('auth.email')}</Label>
                  <Input
                    id="recovery-email"
                    onChange={(e) => setEmail(e.target.value)}
                    type="email"
                    value={email}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="recovery-code">{t('auth.recovery.code')}</Label>
                  <Input
                    id="recovery-code"
                    onChange={(e) => setRecoveryCode(e.target.value)}
                    value={recoveryCode}
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="recovery-password">{t('auth.newPassword')}</Label>
                    <Input
                      id="recovery-password"
                      onChange={(e) => setNewPassword(e.target.value)}
                      type="password"
                      value={newPassword}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="recovery-repeat">{t('auth.repeatPassword')}</Label>
                    <Input
                      id="recovery-repeat"
                      onChange={(e) => setRepeatPassword(e.target.value)}
                      type="password"
                      value={repeatPassword}
                    />
                  </div>
                </div>
                {error ? <p className="text-sm text-red-600">{error}</p> : null}
                <Button className="w-full" disabled={pending} size="large" type="submit">
                  {pending ? t('auth.recovery.progress') : t('auth.recovery.action')}
                </Button>
              </form>
            )}
            <Link
              className="mt-6 flex items-center justify-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground"
              to="/login"
            >
              <ArrowLeft className="size-4" /> {t('auth.recovery.backToLogin')}
            </Link>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
