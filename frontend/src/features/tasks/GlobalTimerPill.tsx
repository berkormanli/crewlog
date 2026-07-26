import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Pause, RotateCcw, Square, Timer } from 'lucide-react';
import { taskSessionsApi } from '@/api';
import { useLiveSeconds, formatSessionDuration } from './useLiveSession';
import { StopSessionModal } from './StopSessionModal';
import type { TaskWorkSession } from '@/types';

/**
 * Persistent task-timer indicator shown above <Outlet /> in AppShell. Visible
 * from every authenticated page (Dashboard, Timesheet, Tasks list, etc.) as
 * long as the current user has an active (running or paused) task session.
 *
 * Math: see useLiveSeconds — uses accumulatedSeconds + (now - activeStartedAt)
 * to avoid double-counting the server's already-ticked elapsedSeconds.
 */
export default function GlobalTimerPill() {
  const qc = useQueryClient();
  const [stopModalOpen, setStopModalOpen] = useState(false);
  const [stopFrozenSeconds, setStopFrozenSeconds] = useState(0);

  const sessionQ = useQuery({
    queryKey: ['active-session'],
    queryFn: () => taskSessionsApi.active(),
    refetchInterval: 30_000, // safety-net poll; mutations invalidate immediately
    refetchOnWindowFocus: true,
    staleTime: 5_000,
  });

  const session: (TaskWorkSession & { task?: { id: string; title: string } | null }) | null =
    sessionQ.data?.session ?? null;

  const liveSeconds = useLiveSeconds(session);

  const mutation = useMutation({
    mutationFn: (args: { action: 'pause' | 'resume' | 'stop'; note?: string }) => {
      if (!session) throw new Error('No active session');
      const taskId = session.taskId;
      if (args.action === 'pause') return taskSessionsApi.pause(taskId);
      if (args.action === 'resume') return taskSessionsApi.resume(taskId);
      return taskSessionsApi.stop(taskId, { note: args.note });
    },
    onSuccess: (_result, args) => {
      qc.invalidateQueries({ queryKey: ['active-session'] });
      qc.invalidateQueries({ queryKey: ['task-sessions', session?.taskId] });
      qc.invalidateQueries({ queryKey: ['task', session?.taskId] });
      qc.invalidateQueries({ queryKey: ['tasks'] });
      qc.invalidateQueries({ queryKey: ['timesheet'] });
      qc.invalidateQueries({ queryKey: ['logs'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      if (args.action === 'stop') {
        // Close the modal on success.
        setStopModalOpen(false);
        // Toast is handled in TaskTimer when the user clicks Stop on the task
        // page; we keep this quiet so we don't double-toast from the header.
      }
    },
    onError: (error: any, args) => {
      if (args.action === 'stop') {
        // Close the modal even on error so the user can retry.
        setStopModalOpen(false);
      }
      // eslint-disable-next-line no-console
      console.error('Timer action failed:', error);
    },
  });

  // Render nothing while loading or when there's no active session.
  if (sessionQ.isLoading) return null;
  if (!session) return null;

  const isRunning = session.status === 'running';
  const taskTitle = session.task?.title ?? 'Active task';
  const taskId = session.taskId;

  const openStopModal = () => {
    setStopFrozenSeconds(liveSeconds);
    setStopModalOpen(true);
  };

  const handleStopConfirm = (note: string) => {
    mutation.mutate({ action: 'stop', note });
  };

  return (
    <>
      <div
        role="status"
        aria-live="polite"
        aria-label={`Task timer ${isRunning ? 'running' : 'paused'} on ${taskTitle}`}
        className={`sticky top-0 z-20 border-b ${
          isRunning
            ? 'bg-brand-50/95 border-brand-100 backdrop-blur'
            : 'bg-amber-50/95 border-amber-200 backdrop-blur'
        }`}
      >
        <div className="px-4 sm:px-6 py-2 flex items-center gap-3 text-sm">
          <span
            className={`inline-flex items-center justify-center w-7 h-7 rounded-full flex-shrink-0 ${
              isRunning ? 'bg-brand-600 text-white' : 'bg-amber-500 text-white'
            }`}
            aria-hidden="true"
          >
            <Timer size={14} />
          </span>

          <div className="min-w-0 flex-1 flex items-center gap-3 flex-wrap">
            <span
              className={`font-mono text-base font-semibold tabular-nums ${
                isRunning ? 'text-brand-800' : 'text-amber-800'
              }`}
              data-testid="global-timer-elapsed"
            >
              {formatSessionDuration(liveSeconds)}
            </span>
            <span
              className={`text-xs uppercase tracking-wide font-semibold ${
                isRunning ? 'text-brand-700' : 'text-amber-700'
              }`}
            >
              {isRunning ? 'Running' : 'Paused'}
            </span>
            <span className="text-slate-400" aria-hidden="true">•</span>
            <Link
              to={`/tasks/${taskId}`}
              className={`truncate font-medium hover:underline ${
                isRunning ? 'text-brand-800' : 'text-amber-900'
              }`}
              title={taskTitle}
            >
              {taskTitle}
            </Link>
          </div>

          <div className="flex items-center gap-2 flex-shrink-0">
            {isRunning ? (
              <button
                type="button"
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium bg-white border border-brand-200 text-brand-700 hover:bg-brand-100 disabled:opacity-50"
                disabled={mutation.isPending}
                onClick={() => mutation.mutate({ action: 'pause' })}
                aria-label="Pause timer"
              >
                <Pause size={12} /> Pause
              </button>
            ) : (
              <button
                type="button"
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium bg-white border border-amber-300 text-amber-800 hover:bg-amber-100 disabled:opacity-50"
                disabled={mutation.isPending}
                onClick={() => mutation.mutate({ action: 'resume' })}
                aria-label="Resume timer"
              >
                <RotateCcw size={12} /> Resume
              </button>
            )}
            <button
              type="button"
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium bg-white border border-red-200 text-red-700 hover:bg-red-50 disabled:opacity-50"
              disabled={mutation.isPending}
              onClick={openStopModal}
              aria-label="Stop timer"
            >
              <Square size={11} /> Stop
            </button>
          </div>
        </div>
      </div>
      <StopSessionModal
        open={stopModalOpen}
        onClose={() => setStopModalOpen(false)}
        onConfirm={handleStopConfirm}
        taskTitle={taskTitle}
        liveSecondsAtOpen={stopFrozenSeconds}
        busy={mutation.isPending}
      />
    </>
  );
}