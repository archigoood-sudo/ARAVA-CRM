import { zodResolver } from '@hookform/resolvers/zod';
import { passwordChangeSchema, type PasswordChangeInput } from '@arava/shared';
import { Button, Card, CardContent, Input, Label } from '@arava/ui';
import { ArrowRight, KeyRound, ShieldCheck } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { useNavigate } from 'react-router-dom';

import { BrandMark } from '../../components/brand-mark';
import { useAuthStore } from '../../stores/auth-store';

export function ChangePasswordPage() {
  const changePassword = useAuthStore((state) => state.changePassword);
  const navigate = useNavigate();
  const {
    formState: { errors, isSubmitting },
    handleSubmit,
    register,
    setError,
  } = useForm<PasswordChangeInput>({
    defaultValues: { currentPassword: '', newPassword: '' },
    resolver: zodResolver(passwordChangeSchema),
  });

  const submit = handleSubmit(async (input) => {
    try {
      await changePassword(input);
      await navigate('/dashboard');
    } catch {
      setError('root', { message: 'The current password is incorrect. Please try again.' });
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
            <h1 className="mt-6 text-3xl font-semibold tracking-[-0.04em]">Secure your account.</h1>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              The initial owner password is temporary. Choose a unique password before entering the
              workspace.
            </p>
            <form className="mt-7 space-y-5" onSubmit={submit}>
              <div className="space-y-2">
                <Label htmlFor="currentPassword">Current password</Label>
                <Input id="currentPassword" type="password" {...register('currentPassword')} />
                {errors.currentPassword ? (
                  <p className="text-sm text-red-600">{errors.currentPassword.message}</p>
                ) : null}
              </div>
              <div className="space-y-2">
                <Label htmlFor="newPassword">New password</Label>
                <Input id="newPassword" type="password" {...register('newPassword')} />
                {errors.newPassword ? (
                  <p className="text-sm text-red-600">{errors.newPassword.message}</p>
                ) : (
                  <p className="text-xs leading-5 text-muted-foreground">
                    12+ characters with uppercase, lowercase, number, and symbol.
                  </p>
                )}
              </div>
              {errors.root ? <p className="text-sm text-red-600">{errors.root.message}</p> : null}
              <Button className="w-full" disabled={isSubmitting} size="large" type="submit">
                {isSubmitting ? 'Securing account…' : 'Set password and continue'}
                <ArrowRight className="size-4" />
              </Button>
            </form>
            <p className="mt-5 flex items-center justify-center gap-2 text-xs text-muted-foreground">
              <ShieldCheck className="size-3.5" /> Passwords are protected with memory-hard scrypt.
            </p>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
