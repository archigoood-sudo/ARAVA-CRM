import { zodResolver } from '@hookform/resolvers/zod';
import { forcedPasswordChangeSchema, t } from '@arava/shared';
import { Button, Card, CardContent, Input, Label } from '@arava/ui';
import { ArrowRight, KeyRound, ShieldCheck } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { useNavigate } from 'react-router-dom';
import { z } from 'zod';

import { BrandMark } from '../../components/brand-mark';
import { useAuthStore } from '../../stores/auth-store';

export function ChangePasswordPage() {
  const completePasswordChange = useAuthStore((state) => state.completePasswordChange);
  const navigate = useNavigate();
  const {
    formState: { errors, isSubmitting },
    handleSubmit,
    register,
    setError,
  } = useForm<{ newPassword: string; repeatPassword: string }>({
    defaultValues: { newPassword: '', repeatPassword: '' },
    resolver: zodResolver(
      forcedPasswordChangeSchema
        .and(z.object({ repeatPassword: z.string().min(1, t('validation.password.required')) }))
        .refine((value) => value.newPassword === value.repeatPassword, {
          message: t('validation.passwordsMatch'),
          path: ['repeatPassword'],
        }),
    ),
  });

  const submit = handleSubmit(async (input) => {
    try {
      await completePasswordChange({ newPassword: input.newPassword });
      await navigate('/dashboard');
    } catch {
      setError('root', { message: t('auth.change.error') });
    }
  });

  return (
    <main className="app-drag-region flex min-h-screen items-center justify-center bg-background p-10">
      <div className="app-no-drag w-full max-w-lg">
        <BrandMark className="mb-8 text-foreground" />
        <Card className="rounded-3xl">
          <CardContent className="p-8">
            <span className="flex size-12 items-center justify-center rounded-2xl bg-accent text-neutral-950">
              <KeyRound className="size-5" />
            </span>
            <h1 className="mt-6 text-3xl font-semibold tracking-[-0.04em]">
              {t('auth.change.title')}
            </h1>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              {t('auth.change.description')}
            </p>
            <form className="mt-7 space-y-5" onSubmit={submit}>
              <div className="space-y-2">
                <Label htmlFor="newPassword">{t('auth.newPassword')}</Label>
                <Input id="newPassword" type="password" {...register('newPassword')} />
                {errors.newPassword ? (
                  <p className="text-sm text-red-600">{errors.newPassword.message}</p>
                ) : (
                  <p className="text-xs leading-5 text-muted-foreground">{t('auth.change.hint')}</p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="repeatPassword">{t('auth.repeatPassword')}</Label>
                <Input id="repeatPassword" type="password" {...register('repeatPassword')} />
                {errors.repeatPassword ? (
                  <p className="text-sm text-red-600">{errors.repeatPassword.message}</p>
                ) : null}
              </div>
              {errors.root ? <p className="text-sm text-red-600">{errors.root.message}</p> : null}
              <Button className="w-full" disabled={isSubmitting} size="large" type="submit">
                {isSubmitting ? t('auth.change.progress') : t('auth.change.action')}
                <ArrowRight className="size-4" />
              </Button>
            </form>
            <p className="mt-5 flex items-center justify-center gap-2 text-xs text-muted-foreground">
              <ShieldCheck className="size-3.5" /> {t('auth.change.security')}
            </p>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
