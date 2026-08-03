import {
  Building2,
  ChevronRight,
  LayoutDashboard,
  Settings,
  ShieldCheck,
  UsersRound,
} from 'lucide-react';
import { NavLink } from 'react-router-dom';

import { cn } from '@arava/ui';

import { useAuthStore } from '../stores/auth-store';
import { BrandMark } from './brand-mark';

export function Sidebar() {
  const user = useAuthStore((state) => state.user);
  const navigation = [
    { icon: LayoutDashboard, label: 'Dashboard', to: '/dashboard' },
    { icon: UsersRound, label: 'Students', to: '/students' },
    { icon: Building2, label: 'Branches', to: '/branches' },
    ...(user?.role === 'OWNER' || user?.role === 'ADMIN'
      ? [{ icon: ShieldCheck, label: 'Users & access', to: '/users' }]
      : []),
  ];
  return (
    <aside className="app-drag-region flex min-h-0 flex-col bg-sidebar px-4 pb-5 pt-9 text-white">
      <BrandMark className="px-3" />
      <nav aria-label="Main navigation" className="app-no-drag mt-12 space-y-1">
        <p className="mb-3 px-3 text-[10px] font-semibold uppercase tracking-[0.2em] text-neutral-600">
          Workspace
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
          <p className="mt-4 text-sm font-semibold">Local and private</p>
          <p className="mt-1 text-xs leading-5 text-neutral-500">
            Data and access controls stay on this device.
          </p>
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
          <span>Settings</span>
          <ChevronRight className="ml-auto size-4" />
        </NavLink>
      </div>
    </aside>
  );
}
