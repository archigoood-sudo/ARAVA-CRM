import { Navigate, Outlet } from 'react-router-dom';

import { BrandedSplash } from './components/branded-splash';
import { useAuthStore } from './stores/auth-store';

export function AuthenticatedRoute() {
  const { status, user } = useAuthStore();
  if (status === 'restoring') return <BrandedSplash />;
  if (!user) return <Navigate replace to="/login" />;
  return user.mustChangePassword ? <Navigate replace to="/change-password" /> : <Outlet />;
}

export function PasswordChangeRoute() {
  const { status, user } = useAuthStore();
  if (status === 'restoring') return <BrandedSplash />;
  if (!user) return <Navigate replace to="/login" />;
  return user.mustChangePassword ? <Outlet /> : <Navigate replace to="/dashboard" />;
}

export function PublicOnlyRoute() {
  const { status, user } = useAuthStore();
  if (status === 'restoring') return <BrandedSplash />;
  if (!user) return <Outlet />;
  return <Navigate replace to={user.mustChangePassword ? '/change-password' : '/dashboard'} />;
}

export function RootRoute() {
  const { status, user } = useAuthStore();
  if (status === 'restoring') return <BrandedSplash />;
  return (
    <Navigate
      replace
      to={!user ? '/login' : user.mustChangePassword ? '/change-password' : '/dashboard'}
    />
  );
}
