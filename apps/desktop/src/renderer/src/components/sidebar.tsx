import {
  BadgeInfo,
  Building2,
  CalendarDays,
  ChevronRight,
  LayoutDashboard,
  Settings,
  Shapes,
  ShieldCheck,
  UsersRound,
} from 'lucide-react';
import { NavLink } from 'react-router-dom';

import { cn } from '@arava/ui';
import { t } from '@arava/shared';

import { useAuthStore } from '../stores/auth-store';
import { BrandMark } from './brand-mark';

export function Sidebar() {
  const user = useAuthStore((state) => state.user);
  const navigation = [
    { icon: LayoutDashboard, label: t('nav.dashboard'), to: '/dashboard' },
    { icon: UsersRound, label: t('nav.students'), to: '/students' },
    { icon: Shapes, label: t('nav.groups'), to: '/groups' },
    { icon: CalendarDays, label: t('nav.schedule'), to: '/schedule' },
    { icon: Building2, label: t('nav.branches'), to: '/branches' },
    ...(user?.role === 'OWNER' || user?.role === 'ADMIN'
      ? [{ icon: ShieldCheck, label: t('nav.users'), to: '/users' }]
      : []),
  ];
  return (
    <aside className="app-drag-region flex min-h-0 flex-col bg-sidebar px-4 pb-5 pt-9 text-white">
      <BrandMark className="px-3" />
      <nav aria-label={t('nav.workspace')} className="app-no-drag mt-12 space-y-1">
        <p className="mb-3 px-3 text-[10px] font-semibold uppercase tracking-[0.2em] text-neutral-600">
          {t('nav.workspace')}
        </p>
        {navigation.map(({ icon: Icon, label, to }) => (
          <NavLink
            className={({ isActive }) =>
              cn(
                'group flex h-11 items-center gap-3 rounded-xl px-3 text-sm font-medium text-neutral-400 transition hover:bg-white/[0.05] hover:text-white',
                isActive && 'bg-white/[0.08] text-white',
              )
            }
            key={to}
            to={to}
          >
            {({ isActive }) => (
              <>
                <Icon className={cn('size-[18px]', isActive && 'text-accent')} />
                <span>{label}</span>
                {isActive ? <span className="ml-auto size-1.5 rounded-full bg-accent" /> : null}
              </>
            )}
          </NavLink>
        ))}
      </nav>
      <div className="mt-auto">
        <div className="app-no-drag mb-4 rounded-2xl border border-white/[0.08] bg-white/[0.04] p-4">
          <span className="flex size-8 items-center justify-center rounded-lg bg-accent/15 text-accent">
            <ShieldCheck className="size-4" />
          </span>
          <p className="mt-4 text-sm font-semibold">{t('privacy.title')}</p>
          <p className="mt-1 text-xs leading-5 text-neutral-500">{t('privacy.description')}</p>
        </div>
        <NavLink
          className={({ isActive }) =>
            cn(
              'app-no-drag flex h-11 items-center gap-3 rounded-xl px-3 text-sm font-medium text-neutral-400 transition hover:bg-white/[0.05] hover:text-white',
              isActive && 'bg-white/[0.08] text-white',
            )
          }
          to="/settings"
        >
          <Settings className="size-[18px]" />
          <span>{t('nav.settings')}</span>
          <ChevronRight className="ml-auto size-4" />
        </NavLink>
        <NavLink
          className={({ isActive }) =>
            cn(
              'app-no-drag mt-1 flex h-11 items-center gap-3 rounded-xl px-3 text-sm font-medium text-neutral-400 transition hover:bg-white/[0.05] hover:text-white',
              isActive && 'bg-white/[0.08] text-white',
            )
          }
          to="/about"
        >
          <BadgeInfo className="size-[18px]" />
          <span>{t('nav.about')}</span>
          <ChevronRight className="ml-auto size-4" />
        </NavLink>
      </div>
    </aside>
  );
}
