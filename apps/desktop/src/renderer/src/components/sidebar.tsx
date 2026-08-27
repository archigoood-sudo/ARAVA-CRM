import {
  BadgeInfo,
  BellRing,
  Building2,
  CalendarDays,
  ChevronRight,
  LayoutDashboard,
  Landmark,
  Inbox,
  MessageCircle,
  Newspaper,
  BarChart3,
  CircleDollarSign,
  FileSpreadsheet,
  FolderTree,
  DoorOpen,
  HandCoins,
  ListChecks,
  IdCard,
  WalletCards,
  Settings,
  Shapes,
  ShieldCheck,
  Tags,
  UsersRound,
  UserRound,
} from 'lucide-react';
import { NavLink } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';

import { cn } from '@arava/ui';
import { t } from '@arava/shared';

import { useAuthStore } from '../stores/auth-store';
import { getDesktopApi } from '../lib/desktop-api';
import { queryKeys } from '../lib/query-keys';
import { getSessionToken } from '../stores/auth-store';
import { BrandMark } from './brand-mark';

export function Sidebar() {
  const user = useAuthStore((state) => state.user);
  const trainer = user?.role === 'COACH';
  const branding = useQuery({
    enabled: Boolean(user),
    queryFn: () => getDesktopApi().settings.getLogo(getSessionToken()),
    queryKey: ['settings', 'branding-logo', user?.id],
    staleTime: Number.POSITIVE_INFINITY,
  });
  const attention = useQuery({
    enabled: Boolean(user && !trainer),
    queryFn: () => getDesktopApi().attention.summary(getSessionToken()),
    queryKey: queryKeys.attentionSummary(user?.id),
    refetchInterval: 60_000,
  });
  const chatAccessKey = `${user?.id ?? ''}:${user?.role ?? ''}:${[...(user?.branchIds ?? [])].sort().join(',')}`;
  const chats = useQuery({
    enabled: Boolean(user),
    queryFn: () => getDesktopApi().chats.list(getSessionToken(), { filter: 'UNREAD' }),
    queryKey: queryKeys.chats(chatAccessKey, { filter: 'UNREAD' }),
    refetchInterval: 20_000,
    retry: false,
  });
  const leadAccessKey = `${user?.id ?? ''}:${user?.role ?? ''}:${[...(user?.branchIds ?? [])].sort().join(',')}`;
  const leads = useQuery({
    enabled: Boolean(user && !trainer),
    queryFn: () => getDesktopApi().leads.list(getSessionToken(), {}),
    queryKey: queryKeys.leads(leadAccessKey),
    refetchInterval: 60_000,
    retry: false,
  });
  const navigation = [
    { icon: LayoutDashboard, label: t('nav.dashboard'), to: '/dashboard' },
    ...(user?.role === 'COACH'
      ? [{ icon: UserRound, label: 'Мой профиль', to: `/trainers/${user.id}` }]
      : []),
    ...(!trainer
      ? [
          {
            badge: attention.data?.total,
            icon: BellRing,
            label: 'Требует внимания',
            to: '/attention',
          },
        ]
      : []),
    ...(!trainer
      ? [{ badge: leads.data?.newCount, icon: Inbox, label: 'Заявки', to: '/leads' }]
      : []),
    { icon: UsersRound, label: trainer ? t('nav.myStudents') : t('nav.students'), to: '/students' },
    { icon: Shapes, label: trainer ? t('nav.myGroups') : t('nav.groups'), to: '/groups' },
    {
      icon: CalendarDays,
      label: trainer ? t('nav.mySchedule') : t('nav.schedule'),
      to: '/schedule',
    },
    ...(!trainer ? [{ icon: ListChecks, label: 'Посещения', to: '/attendance' }] : []),
    { badge: chats.data?.totalUnread, icon: MessageCircle, label: 'Чаты', to: '/chats' },
    ...(!trainer ? [{ icon: Newspaper, label: 'Публикации', to: '/publications' }] : []),
    ...(!trainer ? [{ icon: Tags, label: t('nav.tariffs'), to: '/tariffs' }] : []),
    ...(!trainer ? [{ icon: IdCard, label: 'Карты', to: '/cards' }] : []),
    ...(user?.permissions.canViewPayments
      ? [
          { icon: Landmark, label: t('nav.finance'), to: '/finance' },
          { icon: CircleDollarSign, label: 'Расходы', to: '/expenses' },
          { icon: FolderTree, label: 'Категории расходов', to: '/expense-categories' },
          { icon: WalletCards, label: 'Кассы и счета', to: '/cash' },
          { icon: BarChart3, label: 'Аналитика', to: '/analytics' },
          { icon: FileSpreadsheet, label: 'Отчёты', to: '/reports' },
        ]
      : []),
    {
      icon: HandCoins,
      label: user?.role === 'COACH' ? 'Моя зарплата' : 'Зарплата',
      to: '/payroll',
    },
    ...(!trainer
      ? [
          { icon: Building2, label: t('nav.branches'), to: '/branches' },
          { icon: DoorOpen, label: 'Филиалы и залы', to: '/rooms' },
        ]
      : []),
    ...(user?.permissions.canManageUsers
      ? [{ icon: ShieldCheck, label: t('nav.users'), to: '/users' }]
      : []),
  ];
  return (
    <aside
      className="app-drag-region flex h-screen min-h-0 flex-col overflow-hidden bg-sidebar px-4 pb-5 pt-9 text-white"
      data-testid="sidebar"
    >
      <BrandMark className="shrink-0 px-3" logoDataUrl={branding.data?.dataUrl} />
      <nav
        aria-label={t('nav.workspace')}
        className="app-no-drag mt-8 min-h-0 flex-1 space-y-1 overflow-y-auto pb-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        data-testid="sidebar-navigation"
      >
        <p className="mb-3 px-3 text-[10px] font-semibold uppercase tracking-[0.2em] text-neutral-600">
          {t('nav.workspace')}
        </p>
        {navigation.map(({ badge, icon: Icon, label, to }) => (
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
                {badge ? (
                  <span className="ml-auto min-w-6 rounded-full bg-accent px-1.5 py-0.5 text-center text-[10px] font-bold text-neutral-950">
                    {badge > 99 ? '99+' : badge}
                  </span>
                ) : isActive ? (
                  <span className="ml-auto size-1.5 rounded-full bg-accent" />
                ) : null}
              </>
            )}
          </NavLink>
        ))}
      </nav>
      <div className="mt-3 shrink-0 border-t border-white/[0.07] pt-3" data-testid="sidebar-footer">
        <div className="app-no-drag mb-3 hidden rounded-2xl border border-white/[0.08] bg-white/[0.04] p-4 min-[850px]:block">
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
