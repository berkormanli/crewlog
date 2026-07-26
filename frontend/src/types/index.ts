// Core shared types — mirror the backend response shape.

export type Role = 'worker' | 'manager' | 'admin';

export interface AuthUser {
  id: string;
  email: string;
  fullName: string;
  role: Role;
  avatarUrl: string | null;
  tenantId: string;
  defaultDailyHours?: number;
  timezone?: string;
}

export interface LoginResponse {
  user: AuthUser;
  access: string;
  refresh: string;
}

export interface Project {
  id: string;
  tenantId: string;
  name: string;
  code: string;
  description: string | null;
  status: 'active' | 'paused' | 'archived';
  startDate: string | null;
  endDate: string | null;
  color: string;
  clientName: string | null;
  customerId: string | null;
  customer: { id: string; name: string; code: string | null } | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  members?: ProjectMember[];
}

export interface Customer {
  id: string;
  tenantId: string;
  name: string;
  code: string | null;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  address: string | null;
  notes: string | null;
  status: 'active' | 'archived';
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  projects?: CustomerProjectSummary[];
}

export interface CustomerProjectSummary {
  id: string;
  name: string;
  code: string;
  color: string;
  status: 'active' | 'paused' | 'archived';
}

export type TaskRequestStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';

export interface TaskRequest {
  id: string;
  tenantId: string;
  requestedBy: string;
  requester: TaskUser | null;
  projectId: string | null;
  project: { id: string; name: string; code: string; color: string } | null;
  title: string;
  description: string | null;
  priority: TaskPriority;
  difficulty: TaskDifficulty;
  dueDate: string | null;
  status: TaskRequestStatus;
  reviewedBy: string | null;
  reviewer: { id: string; fullName: string; email: string } | null;
  reviewedAt: string | null;
  reviewNote: string | null;
  createdTaskId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectMember {
  id: string;
  fullName: string;
  email: string;
  role: Role;
  avatarUrl: string | null;
  roleInProject: 'lead' | 'contributor' | 'observer';
}

export type TaskStatus = 'backlog' | 'todo' | 'in_progress' | 'waiting' | 'review' | 'qa' | 'done';
export type TaskPriority = 'low' | 'medium' | 'high' | 'urgent';
export type TaskDifficulty = 'easy' | 'medium' | 'hard' | 'expert';

export interface TaskUser {
  id: string;
  fullName: string;
  email: string;
  avatarUrl: string | null;
}

export interface Task {
  id: string;
  tenantId: string;
  projectId: string;
  title: string;
  description: string | null;
  assigneeId: string | null;
  assignee: TaskUser | null;
  createdBy: string | null;
  creator: TaskUser | null;
  status: TaskStatus;
  priority: TaskPriority;
  difficulty: TaskDifficulty;
  dueDate: string | null;
  actualHours: number;
  createdAt: string;
  updatedAt: string;
}

export interface TaskWorkSession {
  id: string;
  tenantId: string;
  taskId: string;
  workerId: string;
  status: 'running' | 'paused' | 'stopped';
  startedAt: string;
  activeStartedAt: string | null;
  pausedAt: string | null;
  endedAt: string | null;
  elapsedSeconds: number;
  accumulatedSeconds: number;
  durationSeconds: number | null;
  workLogId: string | null;
  createdAt: string;
  updatedAt: string;
}


export interface TaskComment {
  id: string;
  body: string;
  parentId: string | null;
  createdAt: string;
  author: TaskUser | null;
}

export interface TaskActivity {
  id: string;
  action: string;
  payload: Record<string, unknown>;
  createdAt: string;
  actor: { id: string; fullName: string; email: string } | null;
}

export interface TaskWithRelations extends Task {
  comments: TaskComment[];
  activity: TaskActivity[];
}

export interface UserSummary {
  id: string;
  email: string;
  fullName: string;
  role: Role;
  avatarUrl: string | null;
  isActive: boolean;
  lastLoginAt?: string | null;
  createdAt?: string;
  defaultDailyHours?: number;
}

export interface WorkLog {
  id: string;
  tenantId: string;
  workerId: string;
  worker?: { id: string; fullName: string; email: string; avatarUrl: string | null };
  date: string;
  projectId: string | null;
  project?: { id: string; name: string; code: string; color: string } | null;
  customerId: string | null;
  customer?: { id: string; name: string; code: string | null } | null;
  taskId: string | null;
  task?: { id: string; title: string } | null;
  hours: number | null;
  startTime: string | null; // HH:MM
  endTime: string | null;   // HH:MM
  description: string;
  module: string | null;
  moduleOther: string | null;
  activityType: string | null;
  activityTypeOther: string | null;
  location: string | null;
  locationOther: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * A dropdown row used by the activity-log modal. Tenants curate their own
 * list of modules, activity types, and locations and can treat "__other__"
 * as a sentinel value to mean "free-text mode" (the UI then shows a text
 * input).
 */
export interface LookupOption {
  id: string;
  name: string;
  isDefault: boolean;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Sentinel value rendered as "Other\u2026" in dropdowns. */
export const LOOKUP_OTHER = '__other__';

export interface Folder {
  id: string;
  tenant_id: string;
  project_id: string | null;
  parent_id: string | null;
  name: string;
  created_by: string | null;
  created_at: string;
}

export interface DocShape {
  id: string;
  tenantId: string;
  projectId: string | null;
  folderId: string | null;
  name: string;
  description: string | null;
  uploadedBy: string | null;
  uploader: TaskUser | null;
  filePath: string;
  mimeType: string;
  sizeBytes: number;
  version: number;
  parentDocumentId: string | null;
  visibility: 'private' | 'team' | 'project';
  isArchived: boolean;
  createdAt: string;
}

export interface DashboardMe {
  todayHours: number;
  openTaskCount: number;
  upcomingTasks: Task[];
  recentLogs: WorkLog[];
}

export interface DashboardManager {
  teamHoursThisWeek: number;
  overdueTaskCount: number;
  topProjects: { id: string; name: string; code: string; color: string; total: number }[];
  recentActivity: any[];
  hidden?: boolean;
}

export interface TeamSummary {
  from: string;
  to: string;
  heatmap: { date: string; total: number; perWorker: Record<string, number> }[];
  totalsByWorker: Record<string, number>;
  totalsByProject: Record<string, number>;
  rows: any[];
}

/**
 * Weekly Timesheet (TimeCamp-style). One row per (project, task) combination
 * the worker logged time against in the [from, to] window.
 */
export interface TimesheetWorker {
  id: string;
  fullName: string;
  email: string;
  defaultDailyHours: number;
  timezone?: string;
}

export interface TimesheetRow {
  key: string;
  project: { id: string; name: string; code: string; color: string } | null;
  customer: { id: string; name: string; code: string | null } | null;
  task: { id: string; title: string } | null;
  adHoc: boolean;
  dayHours: Record<string, number>;
  total: number;
  entries: WorkLog[];
}

export interface Timesheet {
  worker: TimesheetWorker;
  from: string;
  to: string;
  today: string;
  backdateWindowDays: number;
  days: string[];
  dayExpected: Record<string, number>;
  dayTotals: Record<string, number>;
  dayCompletion: Record<string, number>;
  grandTotal: number;
  rows: TimesheetRow[];
}

export interface CapacityOverride {
  id: string;
  date: string;
  expectedHours: number;
  setBy: string | null;
  updatedAt: string;
}

export interface MyCapacity {
  workerId: string;
  defaultDailyHours: number;
  overrides: CapacityOverride[];
}

export interface CalendarDay {
  date: string;
  logged: number;
  expected: number;
  ratio: number;
  inMonth: boolean;
}

export interface CalendarWeek {
  weekStart: string;
  days: CalendarDay[];
}

export interface CalendarData {
  worker: { id: string; fullName: string; email: string; defaultDailyHours: number; timezone?: string };
  month: string; // YYYY-MM
  from: string;
  to: string;
  today: string;
  weeks: CalendarWeek[];
}

export interface ApiError {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

/**
 * Admin / manager activity feed. One row per recorded action across the
 * tenant. `entity` is a best-effort descriptor (e.g. project name) that maps
 * back to an in-app href so the user can click through.
 */
export interface AuditActor {
  id: string;
  fullName: string;
  email: string | null;
  role: Role | null;
  avatarUrl: string | null;
}

export interface AuditEntityRef {
  label: string;
  href: string | null;
}

export interface AuditLogEntry {
  id: string;
  actorId: string | null;
  actor: AuditActor | null;
  action: string; // e.g. 'work_log.create', 'project.update'
  entityType: string; // 'work_log' | 'project' | ...
  entityId: string | null;
  entity: AuditEntityRef | null;
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface AuditLogFilters {
  entityTypes: string[];
  actions: string[];
  actors: AuditActor[];
}
