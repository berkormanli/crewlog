/**
 * Pure helper for computing a task-work session's elapsed seconds from a
 * database row. Extracted from routes.ts so it can be unit-tested without a
 * database connection.
 *
 * Wall-clock based: for a running session the result is
 *   accumulatedSeconds + (now - active_started_at)
 * For any other status (paused, stopped, missing active_started_at) the
 * result is just accumulatedSeconds — the live delta is zero.
 */
export function asDate(value: unknown): Date {
  return value instanceof Date ? value : new Date(String(value));
}

export interface SessionRow {
  status: string;
  accumulated_seconds?: number | string | null;
  active_started_at?: Date | string | null;
}

export function elapsedSeconds(row: SessionRow, now: Date = new Date()): number {
  const accumulated = Number(row.accumulated_seconds ?? 0);
  if (row.status !== 'running' || !row.active_started_at) return accumulated;
  const activeStarted = asDate(row.active_started_at);
  return accumulated + Math.max(0, Math.floor((now.getTime() - activeStarted.getTime()) / 1000));
}

/**
 * Builds the work-log description for a stopped session. If the user supplied
 * a non-empty note, that wins; otherwise we fall back to a sensible default
 * that references the task title.
 */
export function buildStopDescription(note: string | undefined, taskTitle: string): string {
  const trimmed = (note ?? '').trim();
  return trimmed.length > 0 ? trimmed : `Timer session: ${taskTitle}`;
}