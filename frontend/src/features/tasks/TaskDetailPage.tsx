import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { ArrowLeft, MessageSquare, Pause, Play, RotateCcw, Send, Square, Timer, Trash2 } from 'lucide-react';
import { tasksApi, taskSessionsApi } from '@/api';
import { PageContainer } from '@/components/Avatar';
import { Spinner } from '@/components/Spinner';
import { PRIORITY_BADGE, PRIORITY_LABELS, STATUS_BADGE, STATUS_LABELS, DIFFICULTY_BADGE, DIFFICULTY_LABELS } from '@/lib/ui';
import { useAuthStore } from '@/stores/auth';
import { canManage } from '@/lib/rbac';
import { formatDateTime, fromNow } from '@/lib/format';
import toast from 'react-hot-toast';
import type { TaskStatus, TaskWorkSession } from '@/types';
import { ApiException } from '@/api/client';
import { formatSessionDuration, useLiveSeconds } from './useLiveSession';
import { StopSessionModal } from './StopSessionModal';

function TaskTimer({
  taskId,
  taskTitle,
  active,
  recent,
  loading,
}: {
  taskId: string;
  taskTitle: string;
  active: TaskWorkSession | null;
  recent: TaskWorkSession[];
  loading: boolean;
}) {
  const qc = useQueryClient();
  const [stopModalOpen, setStopModalOpen] = useState(false);
  const [stopFrozenSeconds, setStopFrozenSeconds] = useState(0);
  const [stopTaskTitle, setStopTaskTitle] = useState('');

  // Single source of truth for the corrected live-tick math — shared with the
  // GlobalTimerPill in AppShell so both surfaces never re-introduce the 2x bug.
  const liveSeconds = useLiveSeconds(active);

  const mutation = useMutation({
    mutationFn: (args: { action: 'start' | 'pause' | 'resume' | 'stop'; note?: string }) => {
      const { action, note } = args;
      if (action === 'start') return taskSessionsApi.start(taskId);
      if (action === 'pause') return taskSessionsApi.pause(taskId);
      if (action === 'resume') return taskSessionsApi.resume(taskId);
      return taskSessionsApi.stop(taskId, { note });
    },
    onSuccess: (result, args) => {
      qc.invalidateQueries({ queryKey: ['task-sessions', taskId] });
      qc.invalidateQueries({ queryKey: ['task', taskId] });
      qc.invalidateQueries({ queryKey: ['tasks'] });
      qc.invalidateQueries({ queryKey: ['timesheet'] });
      qc.invalidateQueries({ queryKey: ['logs'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      qc.invalidateQueries({ queryKey: ['active-session'] });
      if (args.action === 'stop') {
        const stopped = result as TaskWorkSession & { roundedHours?: number; workLogId?: string | null };
        toast.success(
          stopped.workLogId
            ? `Session stopped and ${Number(stopped.roundedHours ?? 0).toFixed(2)}h logged`
            : 'Session stopped; less than 15 minutes was not added to the timesheet'
        );
      } else {
        const a = args.action;
        toast.success(a === 'start' ? 'Timer started' : a === 'pause' ? 'Timer paused' : 'Timer resumed');
      }
    },
    onError: (error: any) => toast.error(error?.message ?? 'Timer action failed'),
  });

  const openStopModal = () => {
    // Freeze the displayed duration at the moment the user clicked Stop so the
    // value in the modal matches what the server will record.
    setStopFrozenSeconds(liveSeconds);
    setStopTaskTitle(taskTitle);
    setStopModalOpen(true);
  };

  const handleStopConfirm = (note: string) => {
    mutation.mutate({ action: 'stop', note }, { onSuccess: () => setStopModalOpen(false) });
  };

  const lastStopped = recent.find((session) => session.status === 'stopped');

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <Timer size={16} className="text-brand-600" />
        <h3 className="text-sm font-semibold text-slate-700">Task timer</h3>
      </div>
      {loading ? (
        <div className="text-sm text-slate-400">Loading timer…</div>
      ) : (
        <>
          <div className="rounded-lg bg-slate-50 border border-slate-100 p-4 text-center">
            <div className="font-mono text-3xl font-semibold tracking-tight text-slate-900">
              {formatSessionDuration(liveSeconds)}
            </div>
            <div className="mt-1 text-xs uppercase tracking-wide text-slate-500">
              {active ? active.status : 'not started'}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 mt-3">
            {!active && (
              <button
                className="btn-primary col-span-2 justify-center"
                disabled={mutation.isPending}
                onClick={() => mutation.mutate({ action: 'start' })}
              >
                <Play size={14} /> Start
              </button>
            )}
            {active?.status === 'running' && (
              <button
                className="btn-secondary justify-center"
                disabled={mutation.isPending}
                onClick={() => mutation.mutate({ action: 'pause' })}
              >
                <Pause size={14} /> Break
              </button>
            )}
            {active?.status === 'paused' && (
              <button
                className="btn-primary justify-center"
                disabled={mutation.isPending}
                onClick={() => mutation.mutate({ action: 'resume' })}
              >
                <RotateCcw size={14} /> Resume
              </button>
            )}
            {active && (
              <button
                className="btn-danger justify-center"
                disabled={mutation.isPending}
                onClick={openStopModal}
              >
                <Square size={13} /> Stop
              </button>
            )}
          </div>
          {lastStopped && (
            <p className="mt-3 text-xs text-slate-400">
              Last session: {formatSessionDuration(lastStopped.durationSeconds ?? lastStopped.elapsedSeconds)}
            </p>
          )}
        </>
      )}
      <StopSessionModal
        open={stopModalOpen}
        onClose={() => setStopModalOpen(false)}
        onConfirm={handleStopConfirm}
        taskTitle={stopTaskTitle}
        liveSecondsAtOpen={stopFrozenSeconds}
        busy={mutation.isPending}
      />
    </div>
  );
}

export default function TaskDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const user = useAuthStore((s) => s.user)!;
  const taskQ = useQuery({ queryKey: ['task', id], queryFn: () => tasksApi.get(id) });
  const sessionsQ = useQuery({
    queryKey: ['task-sessions', id],
    queryFn: () => taskSessionsApi.list(id),
    enabled: Boolean(id),
  });

  const [commentBody, setCommentBody] = useState('');
  const [replyTo, setReplyTo] = useState<string | null>(null);

  const statusMut = useMutation({
    mutationFn: (s: TaskStatus) => tasksApi.setStatus(id, s),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['task', id] });
      qc.invalidateQueries({ queryKey: ['tasks'] });
    },
  });

  const commentMut = useMutation({
    mutationFn: (args: { body: string; parentId?: string }) =>
      tasksApi.addComment(id, args.body, args.parentId),
    onSuccess: () => {
      setCommentBody('');
      setReplyTo(null);
      qc.invalidateQueries({ queryKey: ['task', id] });
      toast.success('Comment added');
    },
  });

  const deleteMut = useMutation({
    mutationFn: () => tasksApi.delete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tasks'] });
      toast.success('Task deleted');
      navigate('/tasks');
    },
    onError: (e: any) => {
      if (e instanceof ApiException) toast.error(e.message);
    },
  });

  if (taskQ.isLoading) {
    return (
      <PageContainer>
        <div className="flex items-center gap-2 text-slate-500 text-sm">
          <Spinner /> Loading task…
        </div>
      </PageContainer>
    );
  }
  if (taskQ.isError || !taskQ.data) {
    return (
      <PageContainer>
        <button onClick={() => navigate(-1)} className="btn-ghost">
          <ArrowLeft size={16} /> Back
        </button>
        <p className="text-sm text-red-600 mt-4">Task not found.</p>
      </PageContainer>
    );
  }

  const t = taskQ.data;
  const topLevel = t.comments.filter((c) => !c.parentId);
  const replies = t.comments.filter((c) => c.parentId);

  return (
    <PageContainer>
      <div className="mb-4">
        <button onClick={() => navigate(-1)} className="btn-ghost">
          <ArrowLeft size={16} /> Back
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-4">
          <div className="card p-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <h1 className="text-2xl font-bold text-slate-900">{t.title}</h1>
              <div className="flex flex-wrap items-center gap-2">
                <span className={STATUS_BADGE[t.status]}>{STATUS_LABELS[t.status]}</span>
                <span className={PRIORITY_BADGE[t.priority]}>{PRIORITY_LABELS[t.priority]}</span>
                <span className={DIFFICULTY_BADGE[t.difficulty]} title="Difficulty">
                  Difficulty: {DIFFICULTY_LABELS[t.difficulty]}
                </span>
                {canManage(user.role) && (
                  <button
                    className="btn-danger text-xs"
                    onClick={() => {
                      if (confirm('Delete this task?')) deleteMut.mutate();
                    }}
                  >
                    <Trash2 size={14} /> Delete
                  </button>
                )}
              </div>
            </div>

            {t.description ? (
              <div className="mt-4 text-sm text-slate-700 whitespace-pre-wrap">{t.description}</div>
            ) : (
              <p className="mt-4 text-sm text-slate-400 italic">No description.</p>
            )}

            <div className="mt-6 grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
              <div>
                <div className="text-xs text-slate-500">Project</div>
                <div className="text-slate-800 font-medium">{t.projectId ? <Link to={`/projects/${t.projectId}`} className="hover:underline">View</Link> : '—'}</div>
              </div>
              <div>
                <div className="text-xs text-slate-500">Assignee</div>
                <div className="text-slate-800 font-medium">{t.assignee?.fullName ?? 'Unassigned'}</div>
              </div>
              <div>
                <div className="text-xs text-slate-500">Due date</div>
                <div className="text-slate-800 font-medium">{t.dueDate ? new Date(t.dueDate).toLocaleDateString() : '—'}</div>
              </div>
              <div>
                <div className="text-xs text-slate-500">Hours worked</div>
                <div className="text-slate-800 font-medium">
                  <span className="font-mono">{t.actualHours.toFixed(2)}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Comments */}
          <div className="card p-6">
            <h2 className="font-semibold text-slate-800 flex items-center gap-2 mb-4">
              <MessageSquare size={18} /> Comments ({t.comments.length})
            </h2>

            <div className="space-y-3">
              {topLevel.length === 0 && (
                <p className="text-sm text-slate-400 italic">Be the first to comment.</p>
              )}
              {topLevel.map((c) => {
                const r = replies.filter((x) => x.parentId === c.id);
                return (
                  <div key={c.id} className="border border-slate-100 rounded-lg p-3">
                    <div className="flex items-center gap-2 text-sm">
                      <span className="font-medium text-slate-800">{c.author?.fullName ?? '—'}</span>
                      <span className="text-xs text-slate-400">{fromNow(c.createdAt)}</span>
                    </div>
                    <p className="mt-1 text-sm text-slate-700 whitespace-pre-wrap">{c.body}</p>
                    <button
                      className="text-xs text-brand-600 hover:underline mt-1"
                      onClick={() => setReplyTo(c.id)}
                    >
                      Reply
                    </button>
                    {r.length > 0 && (
                      <div className="mt-2 ml-4 border-l-2 border-slate-100 pl-3 space-y-2">
                        {r.map((rep) => (
                          <div key={rep.id} className="text-sm">
                            <div className="flex items-center gap-2">
                              <span className="font-medium text-slate-800">{rep.author?.fullName ?? '—'}</span>
                              <span className="text-xs text-slate-400">{fromNow(rep.createdAt)}</span>
                            </div>
                            <p className="text-slate-700 whitespace-pre-wrap">{rep.body}</p>
                          </div>
                        ))}
                      </div>
                    )}
                    {replyTo === c.id && (
                      <div className="mt-2">
                        <textarea
                          rows={2}
                          className="input"
                          placeholder={`Reply to ${c.author?.fullName ?? 'comment'}…`}
                          value={commentBody}
                          onChange={(e) => setCommentBody(e.target.value)}
                        />
                        <div className="flex justify-end gap-2 mt-2">
                          <button
                            className="btn-ghost text-xs"
                            onClick={() => {
                              setReplyTo(null);
                              setCommentBody('');
                            }}
                          >
                            Cancel
                          </button>
                          <button
                            className="btn-primary text-xs"
                            disabled={!commentBody || commentMut.isPending}
                            onClick={() => commentMut.mutate({ body: commentBody, parentId: c.id })}
                          >
                            <Send size={14} /> Reply
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {replyTo === null && (
              <div className="mt-4 border-t border-slate-100 pt-4">
                <textarea
                  rows={3}
                  className="input"
                  placeholder="Add a comment…"
                  value={commentBody}
                  onChange={(e) => setCommentBody(e.target.value)}
                />
                <div className="flex justify-end mt-2">
                  <button
                    className="btn-primary"
                    disabled={!commentBody || commentMut.isPending}
                    onClick={() => commentMut.mutate({ body: commentBody })}
                  >
                    {commentMut.isPending ? <Spinner size={14} /> : <>Post comment</>}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Sidebar */}
        <aside className="space-y-4">
          <div className="card p-5">
            <TaskTimer
              taskId={id}
              taskTitle={taskQ.data?.title ?? 'this task'}
              active={sessionsQ.data?.active ?? null}
              recent={sessionsQ.data?.items ?? []}
              loading={sessionsQ.isLoading}
            />
          </div>

          <div className="card p-5">
            <h3 className="text-sm font-semibold text-slate-700 mb-3">Update status</h3>
            <div className="flex flex-col gap-2">
              {(Object.keys(STATUS_LABELS) as TaskStatus[]).map((s) => (
                <button
                  key={s}
                  disabled={t.status === s || statusMut.isPending}
                  className={`btn-secondary justify-start text-sm ${t.status === s ? 'opacity-60' : ''}`}
                  onClick={() => statusMut.mutate(s)}
                >
                  <span className={STATUS_BADGE[s]}>{STATUS_LABELS[s]}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="card p-5">
            <h3 className="text-sm font-semibold text-slate-700 mb-3">Activity</h3>
            <ul className="space-y-3 text-sm">
              {t.activity.map((a) => (
                <li key={a.id} className="flex gap-2">
                  <span className="w-2 h-2 rounded-full bg-slate-300 mt-1.5 flex-shrink-0" />
                  <div>
                    <div className="text-slate-700">
                      <strong>{a.actor?.fullName ?? '—'}</strong>{' '}
                      <span className="text-slate-500">
                        {a.action === 'status_changed'
                          ? `moved status to ${(a.payload as any)?.to}`
                          : a.action}
                      </span>
                    </div>
                    <div className="text-xs text-slate-400">{formatDateTime(a.createdAt)}</div>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </aside>
      </div>
    </PageContainer>
  );
}
