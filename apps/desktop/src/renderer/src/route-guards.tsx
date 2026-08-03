import { Navigate, Outlet } from 'react-router-dom';

import { useAuthStore } from './stores/auth-store';

function RestoringSession() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background">
      <span className="size-8 animate-spin rounded-full border-2 border-border border-t-accent" />
    </main>
  );
}

export function AuthenticatedRoute() {
  const { status, user } = useAuthStore();
  if (status === 'restoring') return <RestoringSession />;
  if (!user) return <Navigate replace to="/login" />;
  return user.mustChangePassword ? <Navigate replace to="/change-password" /> : <Outlet />;
}

export function PasswordChangeRoute() {
  const { status, user } = useAuthStore();
  if (status === 'restoring') return <RestoringSession />;
  if (!user) return <Navigate replace to="/login" />;
  return user.mustChangePassword ? <Outlet /> : <Navigate replace to="/dashboard" />;
}

export function PublicOnlyRoute() {
  const { status, user } = useAuthStore();
  if (status === 'restoring') return <RestoringSession />;
  if (!user) return <Outlet />;
  return <Navigate replace to={user.mustChangePassword ? '/change-password' : '/dashboard'} />;
}

export function RootRoute() {
  const { status, user } = useAuthStore();
  if (status === 'restoring') return <RestoringSession />;
  return (
    <Navigate
      replace
      to={!user ? '/login' : user.mustChangePassword ? '/change-password' : '/dashboard'}
    />
  );
}
