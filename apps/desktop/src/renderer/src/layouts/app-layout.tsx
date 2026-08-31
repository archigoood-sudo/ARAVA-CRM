import { Bell, ChevronsUpDown, LogOut, PanelLeftClose } from 'lucide-react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import { Sidebar } from '../components/sidebar';
import { GlobalCardScanner } from '../components/global-card-scanner';
import { GlobalSearch } from '../components/global-search';
import { IntegrationStatusIndicator } from '../components/integration-status-indicator';
import { t } from '@arava/shared';
import { getDesktopApi } from '../lib/desktop-api';
import { invalidateSyncedEntityCaches } from '../lib/operational-cache';
import { getSessionToken, useAuthStore } from '../stores/auth-store';

const pageTitles: Record<string, { eyebrow: string; title: string }> = {
  '/about': { eyebrow: t('page.about.eyebrow'), title: t('nav.about') },
  '/dashboard': { eyebrow: t('page.dashboard.eyebrow'), title: t('nav.dashboard') },
  '/attention': { eyebrow: 'Операционный центр', title: 'Требует внимания' },
  '/attendance': { eyebrow: 'Ежедневная работа', title: 'Посещения' },
  '/branches': { eyebrow: t('page.branches.eyebrow'), title: t('nav.branches') },
  '/cards': { eyebrow: 'Доступ клиентов', title: 'Карты' },
  '/chats': { eyebrow: 'ARAVA ECOSYSTEM', title: 'Чаты' },
  '/students': { eyebrow: t('page.students.eyebrow'), title: t('nav.students') },
  '/users': { eyebrow: t('page.users.eyebrow'), title: t('nav.users') },
  '/settings': { eyebrow: t('page.settings.eyebrow'), title: t('nav.settings') },
};

export function AppLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const logout = useAuthStore((state) => state.logout);
  const user = useAuthStore((state) => state.user);
  const page = location.pathname.startsWith('/attendance/')
    ? pageTitles['/attendance']
    : location.pathname.startsWith('/students/')
      ? { eyebrow: t('page.profile.eyebrow'), title: t('page.profile.title') }
      : location.pathname.startsWith('/trainers/')
        ? { eyebrow: 'Команда ARAVA', title: 'Профиль тренера' }
        : (pageTitles[location.pathname] ?? pageTitles['/dashboard']);

  useEffect(() => {
    return getDesktopApi().integration.onDataChanged((entityType) => {
      void invalidateSyncedEntityCaches(queryClient, entityType);
    });
  }, [queryClient]);

  useEffect(() => {
    if (!user || user.role === 'COACH') return;
    let stopped = false;
    const recover = async () => {
      try {
        const recovered =
          await getDesktopApi().paymentOperations.recoverPendingSales(getSessionToken());
        if (!stopped && recovered.length > 0) {
          await Promise.all([
            queryClient.invalidateQueries({ queryKey: ['subscriptions'] }),
            queryClient.invalidateQueries({ queryKey: ['payment-operations'] }),
            queryClient.invalidateQueries({ queryKey: ['finance'] }),
            queryClient.invalidateQueries({ queryKey: ['attention'] }),
            queryClient.invalidateQueries({ queryKey: ['dashboard'] }),
          ]);
        }
      } catch {
        // The operation stays retryable and is surfaced by the payment/attention UI.
      }
    };
    const startup = window.setTimeout(() => void recover(), 5_000);
    const interval = window.setInterval(() => void recover(), 60_000);
    return () => {
      stopped = true;
      window.clearTimeout(startup);
      window.clearInterval(interval);
    };
  }, [queryClient, user]);

  const handleLogout = async () => {
    await logout();
    queryClient.clear();
    await navigate('/login');
  };

  return (
    <div className="grid h-screen grid-cols-[264px_minmax(0,1fr)] overflow-hidden bg-background">
      <Sidebar />
      <div className="flex min-w-0 flex-col overflow-hidden">
        <header className="app-drag-region flex h-[88px] shrink-0 items-center justify-between border-b border-border bg-background/90 px-9 backdrop-blur-xl">
          <div className="flex items-center gap-4">
            <button
              aria-label={t('layout.fixedSidebar')}
              className="app-no-drag flex size-9 cursor-default items-center justify-center rounded-lg text-muted-foreground"
              onClick={() => navigate(user?.role === 'COACH' ? '/schedule' : '/attention')}
              type="button"
            >
              <PanelLeftClose className="size-[18px]" />
            </button>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                {page?.eyebrow}
              </p>
              <h1 className="mt-0.5 text-xl font-semibold tracking-[-0.02em]">{page?.title}</h1>
            </div>
          </div>

          <div className="app-no-drag flex items-center gap-2.5">
            <GlobalSearch />
            <IntegrationStatusIndicator />
            <button
              aria-label={t('layout.notifications')}
              className="flex size-10 items-center justify-center rounded-xl border border-border bg-surface text-muted-foreground transition hover:text-foreground"
              onClick={() => navigate('/attention')}
              type="button"
            >
              <Bell className="size-[18px]" />
            </button>
            <button
              aria-label={t('layout.signOut')}
              className="group ml-1 flex items-center gap-2.5 rounded-xl p-1.5 pr-2 transition hover:bg-muted"
              onClick={handleLogout}
              title={t('layout.signOut')}
              type="button"
            >
              <span className="flex size-8 items-center justify-center rounded-lg bg-neutral-900 text-xs font-bold text-white dark:bg-accent dark:text-neutral-950">
                {user?.fullName.charAt(0).toUpperCase()}
              </span>
              <span className="max-w-24 truncate text-sm font-semibold">{user?.fullName}</span>
              <ChevronsUpDown className="size-3.5 text-muted-foreground group-hover:hidden" />
              <LogOut className="hidden size-3.5 text-muted-foreground group-hover:block" />
            </button>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto" data-testid="main-scroll">
          <Outlet />
        </div>
      </div>
      <GlobalCardScanner />
    </div>
  );
}
