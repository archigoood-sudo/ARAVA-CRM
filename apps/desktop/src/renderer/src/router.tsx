import { createHashRouter, Navigate } from 'react-router-dom';

import { LoginPage } from './features/auth/login-page';
import { DashboardPage } from './features/dashboard/dashboard-page';
import { SettingsPage } from './features/settings/settings-page';
import { AppLayout } from './layouts/app-layout';
import { AuthenticatedRoute, PublicOnlyRoute, RootRoute } from './route-guards';

export const router = createHashRouter([
  { element: <RootRoute />, path: '/' },
  {
    element: <PublicOnlyRoute />,
    children: [{ element: <LoginPage />, path: '/login' }],
  },
  {
    element: <AuthenticatedRoute />,
    children: [
      {
        element: <AppLayout />,
        children: [
          { element: <DashboardPage />, path: '/dashboard' },
          { element: <SettingsPage />, path: '/settings' },
        ],
      },
    ],
  },
  { element: <Navigate replace to="/" />, path: '*' },
]);
