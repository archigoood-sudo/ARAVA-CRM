import { createHashRouter, Navigate } from 'react-router-dom';

import { LoginPage } from './features/auth/login-page';
import { AboutPage } from './features/about/about-page';
import { ChangePasswordPage } from './features/auth/change-password-page';
import { BranchesPage } from './features/branches/branches-page';
import { DashboardPage } from './features/dashboard/dashboard-page';
import { SettingsPage } from './features/settings/settings-page';
import { StudentProfilePage } from './features/students/student-profile-page';
import { StudentsPage } from './features/students/students-page';
import { UsersPage } from './features/users/users-page';
import { AppLayout } from './layouts/app-layout';
import {
  AuthenticatedRoute,
  PasswordChangeRoute,
  PublicOnlyRoute,
  RootRoute,
} from './route-guards';

export const router = createHashRouter([
  { element: <RootRoute />, path: '/' },
  {
    element: <PublicOnlyRoute />,
    children: [{ element: <LoginPage />, path: '/login' }],
  },
  {
    element: <PasswordChangeRoute />,
    children: [{ element: <ChangePasswordPage />, path: '/change-password' }],
  },
  {
    element: <AuthenticatedRoute />,
    children: [
      {
        element: <AppLayout />,
        children: [
          { element: <DashboardPage />, path: '/dashboard' },
          { element: <BranchesPage />, path: '/branches' },
          { element: <StudentsPage />, path: '/students' },
          { element: <StudentProfilePage />, path: '/students/:studentId' },
          { element: <UsersPage />, path: '/users' },
          { element: <SettingsPage />, path: '/settings' },
          { element: <AboutPage />, path: '/about' },
        ],
      },
    ],
  },
  { element: <Navigate replace to="/" />, path: '*' },
]);
