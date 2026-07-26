import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Check, Clock, Inbox, Pencil, Trash2, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { taskRequestsApi } from '@/api';
import { PageContainer, PageHeader, Avatar } from '@/components/Avatar';
import { Spinner } from '@/components/Spinner';
import { EmptyState } from '@/components/EmptyState';
import { Modal } from '@/components/Modal';
import { PRIORITY_BADGE, PRIORITY_LABELS, DIFFICULTY_BADGE, DIFFICULTY_LABELS, REQUEST_STATUS_BADGE, REQUEST_STATUS_LABELS } from '@/lib/ui';
import { formatDate, fromNow } from '@/lib/format';
import { TaskRequestModal } from '@/features/tasks/TaskRequestModal';
import type { TaskRequest, TaskRequestStatus } from '@/types';

const STATUSES: TaskRequestStatus[] = ['pending', 'approved', 'rejected', 'cancelled'];

export default function TaskRequestsPage() {
  const [statusFilter, setStatusFilter] = useState<'all' | TaskRequestStatus>('pending');
  const requestsQ = useQuery({
    queryKey: ['task-requests', { status: statusFilter }],
    queryFn: () =>
      taskRequestsApi.list(statusFilter === 'all' ? {} : { status: statusFilter }),
  });

  const counts = useMemo(() => {
    const c: Record<TaskRequestStatus | 'all', number> = {
      pending: 0,
      approved: 0,
      rejected: 0,
      cancelled: 0,
      all: 0,
    };
    return c;
  }, []);

  // For a quick counts badge, fetch all-statuses once.
  const allQ = useQuery({
    queryKey: ['task-requests', { status: 'all-counts' }],
    queryFn: () => taskRequestsApi.list({}),
    staleTime: 15_000,
  });
  const liveCounts = useMemo(() => {
    const c: Record<string, number> = { pending: 0, approved: 0, rejected: 0, cancelled: 0, all: 0 };
    for (const r of allQ.data ?? []) {
      c[r.status] = (c[r.status] ?? 0) + 1;
      c.all += 1;
    }
    return c;
  }, [allQ.data]);
  void counts;

  return (
    <PageContainer>
      <PageHeader
        title="Task Requests"
        subtitle="Workers can request tasks; review and approve them here. Approving creates a real task."
        actions={
          <span className="text-sm text-slate-500 inline-flex items-center gap-1">
            <Inbox size={14} /> {liveCounts.pending ?? 0} pending
          </span>
        }
      />

      <div className="card p-1 mb-4 inline-flex items-center gap-1">
        <FilterChip id="pending" label="Pending" active={statusFilter === 'pending'} count={liveCounts.pending} onClick={setStatusFilter} />
        <FilterChip id="approved" label="Approved" active={statusFilter === 'approved'} count={liveCounts.approved} onClick={setStatusFilter} />
        <FilterChip id="rejected" label="Rejected" active={statusFilter === 'rejected'} count={liveCounts.rejected} onClick={setStatusFilter} />
        <FilterChip id="cancelled" label="Cancelled" active={statusFilter === 'cancelled'} count={liveCounts.cancelled} onClick={setStatusFilter} />
        <FilterChip id="all" label="All" active={statusFilter === 'all'} count={liveCounts.all} onClick={setStatusFilter} />
      </div>

      {requestsQ.isLoading ? (
        <div className="flex items-center gap-2 text-slate-500 text-sm">
          <Spinner /> Loading…
        </div>
      ) : !requestsQ.data || requestsQ.data.length === 0 ? (
        <EmptyState
          icon={<Inbox size={28} />}
          title={statusFilter === 'pending' ? 'No pending requests' : 'Nothing here'}
          description={
            statusFilter === 'pending'
              ? 'When a worker submits a task request, it will appear here for review.'
              : 'No requests match this filter.'
          }
        />
      ) : (
        <div className="space-y-3">
          {requestsQ.data.map((r) => (
            <RequestCard key={r.id} request={r} />
          ))}
        </div>
      )}
    </PageContainer>
  );
}

function FilterChip({
  id,
  label,
  active,
  count,
  onClick,
}: {
  id: 'all' | TaskRequestStatus;
  label: string;
  active: boolean;
  count?: number;
  onClick: (s: 'all' | TaskRequestStatus) => void;
}) {
  return (
    <button
      onClick={() => onClick(id)}
      className={`px-3 py-1.5 text-sm rounded-md transition inline-flex items-center gap-2 ${
        active ? 'bg-slate-100 text-slate-900 font-medium' : 'text-slate-600 hover:bg-slate-50'
      }`}
    >
      {label}
      {typeof count === 'number' && (
        <span className="text-xs text-slate-400 font-mono">{count}</span>
      )}
    </button>
  );
}

function RequestCard({ request }: { request: TaskRequest }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [reviewOpen, setReviewOpen] = useState<'approve' | 'reject' | null>(null);

  const approveMut = useMutation({
    mutationFn: (note: string) => taskRequestsApi.approve(request.id, note || undefined),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['task-requests'] });
      qc.invalidateQueries({ queryKey: ['tasks'] });
      toast.success('Approved — task created');
      setReviewOpen(null);
      // Optional: jump to the new task
      if (data.createdTask?.id) {
        window.location.href = `/tasks/${data.createdTask.id}`;
      }
    },
    onError: (e: any) => toast.error(e?.message ?? 'Failed to approve'),
  });

  const rejectMut = useMutation({
    mutationFn: (note: string) => taskRequestsApi.reject(request.id, note || undefined),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['task-requests'] });
      toast.success('Rejected');
      setReviewOpen(null);
    },
    onError: (e: any) => toast.error(e?.message ?? 'Failed to reject'),
  });

  const deleteMut = useMutation({
    mutationFn: () => taskRequestsApi.remove(request.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['task-requests'] });
      toast.success('Deleted');
    },
  });

  const isPending = request.status === 'pending';
  return (
    <div className="card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className={REQUEST_STATUS_BADGE[request.status]}>
              {REQUEST_STATUS_LABELS[request.status]}
            </span>
            <span className={PRIORITY_BADGE[request.priority]}>
              {PRIORITY_LABELS[request.priority]}
            </span>
            <span
              className={DIFFICULTY_BADGE[request.difficulty]}
              title="Difficulty"
            >
              {DIFFICULTY_LABELS[request.difficulty]}
            </span>
            {request.project ? (
              <Link
                to={`/projects/${request.project.id}`}
                className="inline-flex items-center gap-1 text-xs text-slate-500 hover:underline"
              >
                <span
                  className="w-2 h-2 rounded-full"
                  style={{ background: request.project.color }}
                />
                {request.project.name}
              </Link>
            ) : (
              <span className="text-xs text-slate-400 italic">no project</span>
            )}
          </div>
          <h3 className="mt-2 text-base font-semibold text-slate-900">{request.title}</h3>
          {request.description && (
            <p className="mt-1 text-sm text-slate-700 whitespace-pre-wrap">{request.description}</p>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
            <span className="inline-flex items-center gap-1">
              <Avatar name={request.requester?.fullName ?? '—'} size="sm" />
              <span>
                requested by{' '}
                <strong className="text-slate-700">{request.requester?.fullName ?? '—'}</strong>
              </span>
            </span>
            <span>submitted {fromNow(request.createdAt)}</span>
            {request.dueDate && <span>due {formatDate(request.dueDate)}</span>}
          </div>

          {request.reviewNote && (
            <div className="mt-3 text-xs rounded-md bg-slate-50 border border-slate-100 p-2">
              <span className="text-slate-500 font-medium">Review note:</span>{' '}
              <span className="text-slate-700">{request.reviewNote}</span>
              {request.reviewer && (
                <span className="text-slate-500"> — {request.reviewer.fullName}</span>
              )}
            </div>
          )}

          {request.createdTaskId && (
            <div className="mt-2 text-xs text-emerald-700">
              <Link to={`/tasks/${request.createdTaskId}`} className="hover:underline">
                ✓ Created as task “{request.title}” →
              </Link>
            </div>
          )}
        </div>

        <div className="flex flex-col items-end gap-2 flex-shrink-0">
          {isPending && (
            <div className="flex items-center gap-2">
              <button className="btn-primary text-sm" onClick={() => setReviewOpen('approve')}>
                <Check size={14} /> Approve
              </button>
              <button className="btn-secondary text-sm" onClick={() => setReviewOpen('reject')}>
                <X size={14} /> Reject
              </button>
            </div>
          )}
          <div className="flex items-center gap-1 text-slate-400">
            {isPending && (
              <button
                className="p-1.5 rounded hover:text-brand-600 hover:bg-brand-50"
                onClick={() => setEditing(true)}
                title="Edit request"
              >
                <Pencil size={14} />
              </button>
            )}
            <button
              className="p-1.5 rounded hover:text-red-600 hover:bg-red-50"
              onClick={() => {
                if (confirm(`Delete this request?`)) deleteMut.mutate();
              }}
              title="Delete"
            >
              <Trash2 size={14} />
            </button>
          </div>
        </div>
      </div>

      {editing && (
        <TaskRequestModal request={request} onClose={() => setEditing(false)} />
      )}
      {reviewOpen && (
        <ReviewModal
          kind={reviewOpen}
          onClose={() => setReviewOpen(null)}
          onSubmit={(note) => {
            if (reviewOpen === 'approve') approveMut.mutate(note);
            else rejectMut.mutate(note);
          }}
          pending={approveMut.isPending || rejectMut.isPending}
        />
      )}
    </div>
  );
}

function ReviewModal({
  kind,
  onClose,
  onSubmit,
  pending,
}: {
  kind: 'approve' | 'reject';
  onClose: () => void;
  onSubmit: (note: string) => void;
  pending: boolean;
}) {
  const [note, setNote] = useState('');
  return (
    <Modal open onClose={onClose} title={kind === 'approve' ? 'Approve request' : 'Reject request'}>
      <div className="space-y-3">
        <p className="text-sm text-slate-600">
          {kind === 'approve'
            ? 'Approving creates a real task assigned to the requester and links it to this request.'
            : 'Rejecting will close this request. The requester will be able to see your note.'}
        </p>
        <div>
          <label className="label">
            Note {kind === 'reject' && <span className="text-red-600">*</span>}
          </label>
          <textarea
            rows={3}
            className="input"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={
              kind === 'approve'
                ? 'Optional context for the requester'
                : 'Tell the requester why this was rejected'
            }
          />
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button
            className={kind === 'approve' ? 'btn-primary' : 'btn-danger'}
            disabled={pending || (kind === 'reject' && !note.trim())}
            onClick={() => onSubmit(note.trim())}
          >
            {pending ? <Spinner /> : kind === 'approve' ? 'Approve & create task' : 'Reject'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

export { STATUSES };
void Clock;