import {
  BarChart3,
  Building2,
  ChevronRight,
  CircleDollarSign,
  ContactRound,
  LayoutDashboard,
  Settings,
} from 'lucide-react';
import { NavLink } from 'react-router-dom';

import { cn } from '@arava/ui';

import { BrandMark } from './brand-mark';

const primaryNavigation = [
  { disabled: false, icon: LayoutDashboard, label: 'Dashboard', to: '/dashboard' },
  { disabled: true, icon: ContactRound, label: 'Contacts', to: '/contacts' },
  { disabled: true, icon: Building2, label: 'Companies', to: '/companies' },
  { disabled: true, icon: CircleDollarSign, label: 'Opportunities', to: '/opportunities' },
  { disabled: true, icon: BarChart3, label: 'Reports', to: '/reports' },
] as const;

export function Sidebar() {
  return (
    <aside className="app-drag-region flex min-h-0 flex-col bg-sidebar px-4 pb-5 pt-9 text-white">
      <BrandMark className="px-3" />

      <nav aria-label="Main navigation" className="app-no-drag mt-12 space-y-1">
        <p className="mb-3 px-3 text-[10px] font-semibold uppercase tracking-[0.2em] text-neutral-600">
          Workspace
        </p>
        {primaryNavigation.map(({ disabled, icon: Icon, label, to }) =>
          disabled ? (
            <div
              aria-disabled="true"
              className="flex h-11 cursor-not-allowed items-center gap-3 rounded-xl px-3 text-sm font-medium text-neutral-600"
              key={to}
              title="Coming in the next product milestone"
            >
              <Icon className="size-[18px]" />
              <span>{label}</span>
              <span className="ml-auto text-[9px] font-semibold uppercase tracking-wider">
                Soon
              </span>
            </div>
          ) : (
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
          ),
        )}
      </nav>

      <div className="mt-auto">
        <div className="app-no-drag mb-4 rounded-2xl border border-white/[0.08] bg-white/[0.04] p-4">
          <div className="mb-4 flex items-center justify-between">
            <span className="flex size-8 items-center justify-center rounded-lg bg-accent/15 text-accent">
              <CircleDollarSign className="size-4" />
            </span>
            <span className="rounded-full bg-white/[0.06] px-2 py-1 text-[9px] font-semibold uppercase tracking-wider text-neutral-500">
              Foundation
            </span>
          </div>
          <p className="text-sm font-semibold">Build your pipeline</p>
          <p className="mt-1 text-xs leading-5 text-neutral-500">
            Add customer records in the next milestone.
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
