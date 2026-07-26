import { type TaskDifficulty, type TaskPriority, type TaskStatus } from '@/types';

export const STATUS_LABELS: Record<TaskStatus, string> = {
  backlog: 'Backlog',
  todo: 'To do',
  in_progress: 'In progress',
  waiting: 'Waiting',
  review: 'Review',
  qa: 'QA',
  done: 'Done',
};

export const STATUS_BADGE: Record<TaskStatus, string> = {
  backlog: 'badge-gray',
  todo: 'badge-blue',
  in_progress: 'badge-yellow',
  waiting: 'badge-red',
  review: 'badge-purple',
  qa: 'badge-blue',
  done: 'badge-green',
};

// Foreground accent for the dot placed inside a badge. Pair with the
// matching STATUS_BADGE so the badge gets both a tinted background
// (tone) and a colored dot (meaning) — color is never the only carrier
// of status for color-blind users.
export const STATUS_DOT: Record<TaskStatus, string> = {
  backlog: 'bg-neutral-fg',
  todo: 'bg-info-fg',
  in_progress: 'bg-warn-fg',
  waiting: 'bg-danger-fg',
  review: 'bg-accent-fg',
  qa: 'bg-info-fg',
  done: 'bg-success-fg',
};

export const PRIORITY_LABELS: Record<TaskPriority, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  urgent: 'Urgent',
};

export const PRIORITY_BADGE: Record<TaskPriority, string> = {
  low: 'badge-gray',
  medium: 'badge-blue',
  high: 'badge-yellow',
  urgent: 'badge-red',
};

export const PRIORITY_DOT: Record<TaskPriority, string> = {
  low: 'bg-neutral-fg',
  medium: 'bg-info-fg',
  high: 'bg-warn-fg',
  urgent: 'bg-danger-fg',
};

export const DIFFICULTY_LABELS: Record<TaskDifficulty, string> = {
  easy: 'Easy',
  medium: 'Medium',
  hard: 'Hard',
  expert: 'Expert',
};

export const DIFFICULTY_BADGE: Record<TaskDifficulty, string> = {
  easy: 'badge-green',
  medium: 'badge-blue',
  hard: 'badge-purple',
  expert: 'badge-red',
};

export const DIFFICULTY_DOT: Record<TaskDifficulty, string> = {
  easy: 'bg-success-fg',
  medium: 'bg-info-fg',
  hard: 'bg-accent-fg',
  expert: 'bg-danger-fg',
};

export const STATUS_ORDER: TaskStatus[] = ['backlog', 'todo', 'in_progress', 'waiting', 'review', 'qa', 'done'];

export const REQUEST_STATUS_LABELS: Record<string, string> = {
  pending: 'Pending review',
  approved: 'Approved',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
};

export const REQUEST_STATUS_BADGE: Record<string, string> = {
  pending: 'badge-yellow',
  approved: 'badge-green',
  rejected: 'badge-red',
  cancelled: 'badge-gray',
};

export const REQUEST_STATUS_DOT: Record<string, string> = {
  pending: 'bg-warn-fg',
  approved: 'bg-success-fg',
  rejected: 'bg-danger-fg',
  cancelled: 'bg-neutral-fg',
};