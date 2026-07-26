import { useEffect } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import AppShell from '@/layout/AppShell';
import { RequireAuth, RequireRole } from '@/routes/RequireAuth';
import LoginPage from '@/pages/LoginPage';
import DashboardPage from '@/pages/DashboardPage';
import SettingsPage from '@/pages/SettingsPage';

import TasksListPage from '@/features/tasks/TasksLayout';
import TaskDetailPage from '@/features/tasks/TaskDetailPage';
import TaskRequestsPage from '@/features/tasks/TaskRequestsPage';

import ProjectsListPage from '@/features/projects/ProjectsListPage';
import ProjectDetailPage from '@/features/projects/ProjectDetailPage';

import CustomersListPage from '@/features/customers/CustomersListPage';
import CustomerDetailPage from '@/features/customers/CustomerDetailPage';

import DocumentsPage from '@/features/documents/DocumentsPage';

import TimesheetPage from '@/features/work-logs/TimesheetPage';
import MyLogsPage from '@/features/work-logs/MyLogsPage';
import TeamLogsPage from '@/features/work-logs/TeamLogsPage';

import UsersAdminPage from '@/features/admin/UsersAdminPage';
import LookupsAdminPage from '@/features/admin/LookupsAdminPage';
import ActivityPage from '@/features/activity/ActivityPage';

import { refreshMe } from '@/api/auth';
import { useAuthStore } from '@/stores/auth';
import { ErrorBoundary } from '@/components/ErrorBoundary';

function useBootstrapAuth() {
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const access = useAuthStore((s) => s.access);
  const setUser = useAuthStore((s) => s.setUser);

  useEffect(() => {
    if (access && !user) {
      refreshMe()
        .then(() => {
          queryClient.invalidateQueries();
        })
        .catch(() => setUser(null));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

export default function App() {
  useBootstrapAuth();
  return (
    <ErrorBoundary>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route element={<RequireAuth><AppShell /></RequireAuth>}>
          <Route index element={<DashboardPage />} />
          <Route path="/settings" element={<SettingsPage />} />

          <Route path="/tasks" element={<TasksListPage />} />
          <Route path="/tasks/list" element={<RequireRole roles={['manager', 'admin']}><TasksListPage /></RequireRole>} />
          <Route path="/tasks/requests" element={<RequireRole roles={['manager', 'admin']}><TaskRequestsPage /></RequireRole>} />
          <Route path="/tasks/:id" element={<TaskDetailPage />} />

          <Route path="/projects" element={<ProjectsListPage />} />
          <Route path="/projects/:id" element={<ProjectDetailPage />} />

          <Route path="/customers" element={<CustomersListPage />} />
          <Route path="/customers/:id" element={<CustomerDetailPage />} />

          <Route path="/documents" element={<DocumentsPage />} />

          <Route path="/logs" element={<MyLogsPage />} />
          <Route path="/logs/timesheet" element={<TimesheetPage />} />
          <Route path="/team/logs" element={<RequireRole roles={['manager', 'admin']}><TeamLogsPage /></RequireRole>} />

          <Route
            path="/admin/users"
            element={<RequireRole roles={['admin']}><UsersAdminPage /></RequireRole>}
          />
          <Route
            path="/admin/lookups"
            element={<RequireRole roles={['manager', 'admin']}><LookupsAdminPage /></RequireRole>}
          />
          <Route
            path="/admin/projects"
            element={<RequireRole roles={['admin']}><ProjectsListPage /></RequireRole>}
          />
          <Route
            path="/admin/activity"
            element={<RequireRole roles={['manager', 'admin']}><ActivityPage /></RequireRole>}
          />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </ErrorBoundary>
  );
}
