import { createHashRouter, Navigate } from 'react-router-dom';

import { LoginPage } from './features/auth/login-page';
import { AboutPage } from './features/about/about-page';
import { ChangePasswordPage } from './features/auth/change-password-page';
import { ForgotPasswordPage } from './features/auth/forgot-password-page';
import { BranchesPage } from './features/branches/branches-page';
import { DashboardPage } from './features/dashboard/dashboard-page';
import { AttentionPage } from './features/attention/attention-page';
import { AttendancePage } from './features/attendance/attendance-page';
import { AttendanceWorkspacePage } from './features/attendance/attendance-workspace-page';
import { FinancePage } from './features/finance/finance-page';
import { ExpensesPage } from './features/expenses/expenses-page';
import { ExpenseCategoriesPage } from './features/expenses/expense-categories-page';
import { CashPage } from './features/cash/cash-page';
import { CardsPage } from './features/cards/cards-page';
import { ChatsPage } from './features/chats/chats-page';
import { PublicationsPage } from './features/publications/publications-page';
import { LeadsPage } from './features/leads/leads-page';
import { PayrollPage } from './features/payroll/payroll-page';
import { AnalyticsPage } from './features/analytics/analytics-page';
import { ReportsPage } from './features/reports/reports-page';
import { RoomsPage } from './features/rooms/rooms-page';
import { GroupProfilePage } from './features/groups/group-profile-page';
import { GroupsPage } from './features/groups/groups-page';
import { LessonDetailsPage } from './features/schedule/lesson-details-page';
import { SchedulePage } from './features/schedule/schedule-page';
import { SettingsPage } from './features/settings/settings-page';
import { StudentProfilePage } from './features/students/student-profile-page';
import { StudentsPage } from './features/students/students-page';
import { TariffsPage } from './features/tariffs/tariffs-page';
import { UsersPage } from './features/users/users-page';
import { TrainerProfilePage } from './features/trainers/trainer-profile-page';
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
    children: [
      { element: <LoginPage />, path: '/login' },
      { element: <ForgotPasswordPage />, path: '/forgot-password' },
    ],
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
          { element: <AttentionPage />, path: '/attention' },
          { element: <BranchesPage />, path: '/branches' },
          { element: <RoomsPage />, path: '/rooms' },
          { element: <GroupsPage />, path: '/groups' },
          { element: <GroupProfilePage />, path: '/groups/:groupId' },
          { element: <SchedulePage />, path: '/schedule' },
          { element: <LessonDetailsPage />, path: '/lessons/:lessonId' },
          { element: <AttendanceWorkspacePage />, path: '/attendance' },
          { element: <AttendancePage />, path: '/attendance/:lessonId' },
          { element: <StudentsPage />, path: '/students' },
          { element: <StudentProfilePage />, path: '/students/:studentId' },
          { element: <CardsPage />, path: '/cards' },
          { element: <ChatsPage />, path: '/chats' },
          { element: <PublicationsPage />, path: '/publications' },
          { element: <LeadsPage />, path: '/leads' },
          { element: <TariffsPage />, path: '/tariffs' },
          { element: <FinancePage />, path: '/finance' },
          { element: <ExpensesPage />, path: '/expenses' },
          { element: <ExpenseCategoriesPage />, path: '/expense-categories' },
          { element: <CashPage />, path: '/cash' },
          { element: <PayrollPage />, path: '/payroll' },
          { element: <AnalyticsPage />, path: '/analytics' },
          { element: <ReportsPage />, path: '/reports' },
          { element: <UsersPage />, path: '/users' },
          { element: <TrainerProfilePage />, path: '/trainers/:trainerId' },
          { element: <SettingsPage />, path: '/settings' },
          { element: <AboutPage />, path: '/about' },
        ],
      },
    ],
  },
  { element: <Navigate replace to="/" />, path: '*' },
]);
