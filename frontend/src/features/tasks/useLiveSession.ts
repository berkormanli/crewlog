import { useEffect, useState } from 'react';
import type { TaskWorkSession } from '@/types';

/**
 * Returns a per-second ticking "current total seconds" for a task-work session.
 *
 * For a running session, the server's `elapsedSeconds` is already
 * `accumulatedSeconds + (now - activeStartedAt)` (computed against the moment
 * of the API response). To avoid double-counting on the client, we base the
 * local tick on `accumulatedSeconds` (committed seconds) and add the live
 * delta exactly once. For non-running sessions the live delta is zero, so
 * `accumulatedSeconds` is the correct total.
 */
export function useLiveSeconds(session: TaskWorkSession | null | undefined): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!session || session.status !== 'running') return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [session]);

  if (!session) return 0;
  if (session.status !== 'running' || !session.activeStartedAt) {
    return session.accumulatedSeconds;
  }
  return (
    session.accumulatedSeconds +
    Math.max(0, Math.floor((now - new Date(session.activeStartedAt).getTime()) / 1000))
  );
}

export function formatSessionDuration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`;
}