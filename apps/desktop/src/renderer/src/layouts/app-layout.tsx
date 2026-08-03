import { Bell, ChevronsUpDown, LogOut, PanelLeftClose, Search } from 'lucide-react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';

import { Sidebar } from '../components/sidebar';
import { useAuthStore } from '../stores/auth-store';

const pageTitles: Record<string, { eyebrow: string; title: string }> = {
  '/dashboard': { eyebrow: 'Overview', title: 'Dashboard' },
  '/branches': { eyebrow: 'Organization', title: 'Branches' },
  '/students': { eyebrow: 'Community', title: 'Students' },
  '/users': { eyebrow: 'Security', title: 'Users & access' },
  '/settings': { eyebrow: 'Workspace', title: 'Settings' },
};

export function AppLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const logout = useAuthStore((state) => state.logout);
  const user = useAuthStore((state) => state.user);
  const page = location.pathname.startsWith('/students/')
    ? { eyebrow: 'Student record', title: 'Profile' }
    : (pageTitles[location.pathname] ?? pageTitles['/dashboard']);

  const handleLogout = async () => {
    await logout();
    await navigate('/login');
  };

  return (
    <div className="grid h-screen grid-cols-[264px_minmax(0,1fr)] overflow-hidden bg-background">
      <Sidebar />
      <div className="flex min-w-0 flex-col overflow-hidden">
        <header className="app-drag-region flex h-[88px] shrink-0 items-center justify-between border-b border-border bg-background/90 px-9 backdrop-blur-xl">
          <div className="flex items-center gap-4">
            <button
              aria-label="Sidebar is fixed in this layout"
              className="app-no-drag flex size-9 cursor-default items-center justify-center rounded-lg text-muted-foreground"
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
            <div className="mr-2 flex h-10 w-60 items-center gap-2.5 rounded-xl border border-border bg-surface px-3 text-sm text-muted-foreground">
              <Search className="size-4" />
              <span>Search workspace</span>
              <kbd className="ml-auto rounded-md border border-border bg-muted px-1.5 py-0.5 text-[10px] font-medium">
                ⌘K
              </kbd>
            </div>
            <button
              aria-label="Notifications"
              className="flex size-10 items-center justify-center rounded-xl border border-border bg-surface text-muted-foreground transition hover:text-foreground"
              type="button"
            >
              <Bell className="size-[18px]" />
            </button>
            <button
              aria-label="Sign out"
              className="group ml-1 flex items-center gap-2.5 rounded-xl p-1.5 pr-2 transition hover:bg-muted"
              onClick={handleLogout}
              title="Sign out"
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

        <div className="min-h-0 flex-1 overflow-y-auto">
          <Outlet />
        </div>
      </div>
    </div>
  );
}
