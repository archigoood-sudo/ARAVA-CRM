import { zodResolver } from '@hookform/resolvers/zod';
import { loginCredentialsSchema, type LoginCredentials } from '@arava/shared';
import { Button, Input, Label } from '@arava/ui';
import { ArrowRight, BarChart3, Check, ShieldCheck, Sparkles } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { useNavigate } from 'react-router-dom';

import { BrandMark } from '../../components/brand-mark';
import { useAuthStore } from '../../stores/auth-store';

const productHighlights = [
  'A focused workspace for your entire customer lifecycle',
  'Local-first data with a fast native desktop experience',
  'A clean foundation designed to scale with your team',
];

export function LoginPage() {
  const navigate = useNavigate();
  const login = useAuthStore((state) => state.login);
  const {
    formState: { errors, isSubmitting },
    handleSubmit,
    register,
  } = useForm<LoginCredentials>({
    defaultValues: { email: '', password: '' },
    resolver: zodResolver(loginCredentialsSchema),
  });

  const submit = handleSubmit(async (credentials) => {
    await Promise.resolve();
    login(credentials);
    await navigate('/dashboard');
  });

  return (
    <main className="grid min-h-screen grid-cols-[minmax(440px,0.92fr)_minmax(560px,1.08fr)] bg-background">
      <section className="app-drag-region flex min-h-screen flex-col bg-sidebar px-14 py-12 text-white">
        <BrandMark />

        <div className="my-auto max-w-xl py-16">
          <div className="mb-8 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.06] px-3 py-1.5 text-xs font-medium text-neutral-300">
            <Sparkles className="size-3.5 text-accent" />
            Customer relationships, beautifully organized
          </div>
          <h1 className="text-balance text-6xl font-semibold leading-[1.02] tracking-[-0.055em]">
            The calm center for your customer work.
          </h1>
          <p className="mt-7 max-w-lg text-lg leading-8 text-neutral-400">
            ARAVA brings your contacts, companies, and opportunities into one considered desktop
            workspace.
          </p>

          <div className="mt-12 space-y-4">
            {productHighlights.map((highlight) => (
              <div className="flex items-start gap-3 text-sm text-neutral-300" key={highlight}>
                <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-accent text-neutral-950">
                  <Check className="size-3" strokeWidth={3} />
                </span>
                {highlight}
              </div>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
            <ShieldCheck className="mb-4 size-5 text-accent" />
            <p className="text-sm font-medium">Local-first foundation</p>
            <p className="mt-1 text-xs leading-5 text-neutral-500">
              Your workspace starts on-device.
            </p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
            <BarChart3 className="mb-4 size-5 text-accent" />
            <p className="text-sm font-medium">Built for clarity</p>
            <p className="mt-1 text-xs leading-5 text-neutral-500">Know what deserves attention.</p>
          </div>
        </div>
      </section>

      <section className="app-drag-region flex min-h-screen items-center justify-center px-16 py-12">
        <div className="app-no-drag w-full max-w-md">
          <div className="mb-10">
            <p className="mb-3 text-sm font-semibold text-accent-foreground dark:text-accent">
              Welcome back
            </p>
            <h2 className="text-4xl font-semibold tracking-[-0.04em]">Sign in to ARAVA</h2>
            <p className="mt-3 text-base leading-7 text-muted-foreground">
              Enter your workspace credentials to continue.
            </p>
          </div>

          <form className="space-y-5" onSubmit={submit}>
            <div className="space-y-2.5">
              <Label htmlFor="email">Email address</Label>
              <Input
                autoComplete="email"
                autoFocus
                id="email"
                placeholder="you@company.com"
                type="email"
                {...register('email')}
              />
              {errors.email ? (
                <p className="text-sm font-medium text-red-600 dark:text-red-400">
                  {errors.email.message}
                </p>
              ) : null}
            </div>

            <div className="space-y-2.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="password">Password</Label>
                <span className="text-xs font-medium text-muted-foreground">
                  8 characters minimum
                </span>
              </div>
              <Input
                autoComplete="current-password"
                id="password"
                placeholder="Enter your password"
                type="password"
                {...register('password')}
              />
              {errors.password ? (
                <p className="text-sm font-medium text-red-600 dark:text-red-400">
                  {errors.password.message}
                </p>
              ) : null}
            </div>

            <Button className="mt-2 w-full" disabled={isSubmitting} size="large" type="submit">
              {isSubmitting ? 'Signing in…' : 'Continue to workspace'}
              <ArrowRight className="size-4" />
            </Button>
          </form>

          <p className="mt-8 text-center text-xs leading-5 text-muted-foreground">
            Authentication is local in this foundation build. Your password is validated but never
            stored.
          </p>
        </div>
      </section>
    </main>
  );
}
