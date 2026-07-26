import { api } from './client';
import type {
  AuditLogEntry,
  AuditLogFilters,
  CalendarData,
  Customer,
  DashboardManager,
  DashboardMe,
  DocShape,
  Folder,
  LookupOption,
  MyCapacity,
  Project,
  ProjectMember,
  Task,
  TaskComment,
  TaskRequest,
  TaskStatus,
  TaskWorkSession,
  TaskWithRelations,
  TeamSummary,
  Timesheet,
  UserSummary,
  WorkLog,
} from '@/types';

// ---- Projects ----
export const projectsApi = {
  list: () => api.get<Project[]>('/api/v1/projects'),
  get: (id: string) => api.get<Project & { members: ProjectMember[] }>(`/api/v1/projects/${id}`),
  create: (data: Partial<Project>) => api.post<Project>('/api/v1/projects', { json: data }),
  update: (id: string, data: Partial<Project>) =>
    api.patch<Project>(`/api/v1/projects/${id}`, { json: data }),
  addMember: (id: string, userId: string, role: 'lead' | 'contributor' | 'observer' = 'contributor') =>
    api.post(`/api/v1/projects/${id}/members`, { json: { userId, roleInProject: role } }),
  removeMember: (id: string, userId: string) =>
    api.delete(`/api/v1/projects/${id}/members/${userId}`),
};

// ---- Customers ----
export const customersApi = {
  list: (params: Record<string, string | undefined> = {}) => {
    const qs = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => v && qs.set(k, v));
    const s = qs.toString();
    return api.get<Customer[]>(`/api/v1/customers${s ? `?${s}` : ''}`);
  },
  get: (id: string) =>
    api.get<Customer & { projects: { id: string; name: string; code: string; color: string; status: string }[] }>(
      `/api/v1/customers/${id}`
    ),
  create: (data: Partial<Customer>) => api.post<Customer>('/api/v1/customers', { json: data }),
  update: (id: string, data: Partial<Customer>) =>
    api.patch<Customer>(`/api/v1/customers/${id}`, { json: data }),
  remove: (id: string) => api.delete(`/api/v1/customers/${id}`),
};

// ---- Tasks ----
export const tasksApi = {
  list: (params: Record<string, string | undefined> = {}) => {
    const qs = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => v && qs.set(k, v));
    const s = qs.toString();
    return api.get<Task[]>(`/api/v1/tasks${s ? `?${s}` : ''}`);
  },
  get: (id: string) => api.get<TaskWithRelations>(`/api/v1/tasks/${id}`),
  create: (data: Partial<Task> & { projectId: string }) =>
    api.post<Task>('/api/v1/tasks', { json: data }),
  update: (id: string, data: Partial<Task>) =>
    api.patch<Task>(`/api/v1/tasks/${id}`, { json: data }),
  delete: (id: string) => api.delete(`/api/v1/tasks/${id}`),
  setStatus: (id: string, status: TaskStatus) =>
    api.post<Task>(`/api/v1/tasks/${id}/status`, { json: { status } }),
  addComment: (id: string, body: string, parentId?: string) =>
    api.post<TaskComment>(`/api/v1/tasks/${id}/comments`, { json: { body, parentId } }),
};

export const taskSessionsApi = {
  list: (taskId: string) =>
    api.get<{ active: TaskWorkSession | null; items: TaskWorkSession[] }>(`/api/v1/tasks/${taskId}/sessions`),
  active: () =>
    api.get<{
      session: (TaskWorkSession & { task: { id: string; title: string } | null }) | null;
    }>(`/api/v1/task-sessions/active`),
  start: (taskId: string) => api.post<TaskWorkSession>(`/api/v1/tasks/${taskId}/sessions/start`, { json: {} }),
  pause: (taskId: string) => api.post<TaskWorkSession>(`/api/v1/tasks/${taskId}/sessions/pause`, { json: {} }),
  resume: (taskId: string) => api.post<TaskWorkSession>(`/api/v1/tasks/${taskId}/sessions/resume`, { json: {} }),
  stop: (taskId: string, opts?: { note?: string }) =>
    api.post<TaskWorkSession & { roundedHours: number; workLogId: string | null }>(
      `/api/v1/tasks/${taskId}/sessions/stop`,
      { json: { note: opts?.note ?? '' } }
    ),
};

// ---- Task requests (workers submit, managers review) ----
export const taskRequestsApi = {
  list: (params: Record<string, string | undefined> = {}) => {
    const qs = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => v && qs.set(k, v));
    const s = qs.toString();
    return api.get<TaskRequest[]>(`/api/v1/task-requests${s ? `?${s}` : ''}`);
  },
  get: (id: string) => api.get<TaskRequest>(`/api/v1/task-requests/${id}`),
  create: (data: {
    projectId?: string | null;
    title: string;
    description?: string;
    priority?: 'low' | 'medium' | 'high' | 'urgent';
    dueDate?: string;
    difficulty?: 'easy' | 'medium' | 'hard' | 'expert';
  }) => api.post<TaskRequest>('/api/v1/task-requests', { json: data }),
  update: (id: string, data: Partial<{
    title: string;
    description: string;
    priority: 'low' | 'medium' | 'high' | 'urgent';
    difficulty: 'easy' | 'medium' | 'hard' | 'expert';
    dueDate: string | null;
    projectId: string | null;
  }>) => api.patch<TaskRequest>(`/api/v1/task-requests/${id}`, { json: data }),
  remove: (id: string) => api.delete(`/api/v1/task-requests/${id}`),
  approve: (id: string, note?: string) =>
    api.post<TaskRequest & { createdTask: Task }>(`/api/v1/task-requests/${id}/approve`, { json: { note } }),
  reject: (id: string, note?: string) =>
    api.post<TaskRequest>(`/api/v1/task-requests/${id}/reject`, { json: { note } }),
};

// ---- Users ----
export const usersApi = {
  list: () => api.get<UserSummary[]>('/api/v1/users'),
  create: (data: { email: string; password: string; fullName: string; role: 'worker' | 'manager' | 'admin'; defaultDailyHours?: number }) =>
    api.post<UserSummary>('/api/v1/users', { json: data }),
  update: (id: string, data: Partial<UserSummary> & { password?: string }) =>
    api.patch<UserSummary>(`/api/v1/users/${id}`, { json: data }),
  deactivate: (id: string) => api.post(`/api/v1/users/${id}/deactivate`),
};

// ---- Work Logs ----
export const workLogsApi = {
  list: (params: Record<string, string | undefined> = {}) => {
    const qs = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => v && qs.set(k, v));
    const s = qs.toString();
    return api.get<{ items: WorkLog[] }>(`/api/v1/work-logs${s ? `?${s}` : ''}`);
  },
  today: () => api.get<{ date: string; total: number; items: WorkLog[] }>('/api/v1/work-logs/today'),
  timesheet: (params: { from?: string; to?: string; worker?: string } = {}) => {
    const qs = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => v && qs.set(k, v));
    const s = qs.toString();
    return api.get<Timesheet>(`/api/v1/work-logs/timesheet${s ? `?${s}` : ''}`);
  },
  calendar: (params: { month?: string; worker?: string } = {}) => {
    const qs = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => v && qs.set(k, v));
    const s = qs.toString();
    return api.get<CalendarData>(`/api/v1/work-logs/calendar${s ? `?${s}` : ''}`);
  },
  teamSummary: (params: Record<string, string | undefined>) => {
    const qs = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => v && qs.set(k, v));
    return api.get<TeamSummary>(`/api/v1/work-logs/team-summary?${qs.toString()}`);
  },
  create: (
    data: Pick<WorkLog, 'date' | 'description'> &
      Partial<Pick<WorkLog, 'projectId' | 'customerId' | 'taskId' | 'hours' | 'startTime' | 'endTime' | 'module' | 'moduleOther' | 'activityType' | 'activityTypeOther' | 'location' | 'locationOther'>>
  ) => api.post<WorkLog>('/api/v1/work-logs', { json: data }),
  update: (id: string, data: Partial<WorkLog>) =>
    api.patch<WorkLog>(`/api/v1/work-logs/${id}`, { json: data }),
  delete: (id: string) => api.delete(`/api/v1/work-logs/${id}`),
};

// ---- Lookups (modules + activity types + locations) ----
const lookupApi = (table: 'work_modules' | 'work_activity_types' | 'work_locations') => ({
  list: () => api.get<LookupOption[]>(`/api/v1/${table}`),
  create: (name: string) =>
    api.post<LookupOption>(`/api/v1/${table}`, {
      json: { name },
    }),
  update: (id: string, name: string) =>
    api.patch<LookupOption>(`/api/v1/${table}/${id}`, { json: { name } }),
  remove: (id: string) => api.delete<{ ok: true }>(`/api/v1/${table}/${id}`),
});

export const workModulesApi = lookupApi('work_modules');
export const workActivityTypesApi = lookupApi('work_activity_types');
export const workLocationsApi = lookupApi('work_locations');

// ---- Capacity (per-day expected hours) ----
export const capacityApi = {
  me: (params: { from?: string; to?: string } = {}) => {
    const qs = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => v && qs.set(k, v));
    const s = qs.toString();
    return api.get<MyCapacity>(`/api/v1/capacity/me${s ? `?${s}` : ''}`);
  },
  set: (date: string, expectedHours: number) =>
    api.put<{ date: string; expectedHours: number }>(`/api/v1/capacity/me/${date}`, {
      json: { date, expectedHours },
    }),
  clear: (date: string) => api.delete<{ ok: true }>(`/api/v1/capacity/me/${date}`),
};

// ---- Documents ----
export const documentsApi = {
  list: (params: Record<string, string | undefined> = {}) => {
    const qs = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => v && qs.set(k, v));
    const s = qs.toString();
    return api.get<DocShape[]>(`/api/v1/documents${s ? `?${s}` : ''}`);
  },
  get: (id: string) => api.get<DocShape>(`/api/v1/documents/${id}`),
  versions: (id: string) => api.get<{ id: string; version: number; name: string; size_bytes: number; mime_type: string; created_at: string }[]>(`/api/v1/documents/${id}/versions`),
  upload: (form: FormData) =>
    api.post<DocShape>('/api/v1/documents', { formData: form }),
  update: (id: string, data: Partial<DocShape>) =>
    api.patch<DocShape>(`/api/v1/documents/${id}`, { json: data }),
  archive: (id: string) => api.post<{ isArchived: boolean }>(`/api/v1/documents/${id}/archive`),
  delete: (id: string) => api.delete(`/api/v1/documents/${id}`),
};

// ---- Folders ----
export const foldersApi = {
  list: (params: { project?: string } = {}) => {
    const qs = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => v && qs.set(k, v));
    const s = qs.toString();
    return api.get<Folder[]>(`/api/v1/folders${s ? `?${s}` : ''}`);
  },
  create: (data: { name: string; projectId?: string | null; parentId?: string | null }) =>
    api.post<Folder>('/api/v1/folders', { json: data }),
  update: (id: string, data: { name: string }) =>
    api.patch<Folder>(`/api/v1/folders/${id}`, { json: data }),
  delete: (id: string) => api.delete(`/api/v1/folders/${id}`),
};

// ---- Dashboard ----
export const dashboardApi = {
  me: () => api.get<DashboardMe>('/api/v1/dashboard/me'),
  manager: () => api.get<DashboardManager>('/api/v1/dashboard/manager'),
};

// ---- Audit log (admin/manager activity feed) ----
export const auditApi = {
  list: (params: {
    entityType?: string;
    entityId?: string;
    actor?: string;
    action?: string;
    from?: string;
    to?: string;
    q?: string;
    before?: string;
    limit?: number;
  } = {}) => {
    const qs = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== '') qs.set(k, String(v));
    });
    const s = qs.toString();
    return api.get<{ items: AuditLogEntry[]; nextCursor: string | null; hasMore: boolean }>(
      `/api/v1/audit-log${s ? `?${s}` : ''}`
    );
  },
  filters: () =>
    api.get<AuditLogFilters>('/api/v1/audit-log/filters'),
};
