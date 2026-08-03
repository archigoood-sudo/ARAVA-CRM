import { Navigate, Outlet } from 'react-router-dom';

import { useAuthStore } from './stores/auth-store';

export function AuthenticatedRoute() {
  const user = useAuthStore((state) => state.user);
  return user ? <Outlet /> : <Navigate replace to="/login" />;
}

export function PublicOnlyRoute() {
  const user = useAuthStore((state) => state.user);
  return user ? <Navigate replace to="/dashboard" /> : <Outlet />;
}

export function RootRoute() {
  const user = useAuthStore((state) => state.user);
  return <Navigate replace to={user ? '/dashboard' : '/login'} />;
}
