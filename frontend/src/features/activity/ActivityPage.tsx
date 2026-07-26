import { useEffect, useMemo, useState } from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import {
  Activity,
  Archive,
  Check,
  ChevronDown,
  Edit3,
  FilePlus2,
  FolderPlus,
  Link as LinkIcon,
  Loader2,
  Mail,
  Plus,
  Search,
  ShieldAlert,
  Trash2,
  UserPlus,
  X,
  type LucideIcon,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { auditApi } from '@/api';
import { Avatar, PageContainer, PageHeader } from '@/components/Avatar';
import { Modal } from '@/components/Modal';
import { Spinner } from '@/components/Spinner';
import { EmptyState } from '@/components/EmptyState';
import { formatDateTime, fromNow } from '@/lib/format';
import { canManage } from '@/lib/rbac';
import { useAuthStore } from '@/stores/auth';
import type { AuditLogEntry } from '@/types';

const PAGE_SIZE = 50;

/**
 * Activity feed for admin / manager users. Lets you see who did what to what
 * in a single chronological timeline, with rich filtering by entity type,
 * actor, action, and date range. Click-through on individual rows surfaces
 * the underlying record (when a router href is known).
 */
export default function ActivityPage() {
  const user = useAuthStore((s) => s.user)!;
  const navigate = useNavigate();
  const role = user.role;

  // Filters (text inputs and selects).
  const [q, setQ] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [entityType, setEntityType] = useState<string>('');
  const [action, setAction] = useState<string>('');
  const [actor, setActor] = useState<string>('');
  const [from, setFrom] = useState<string>('');
  const [to, setTo] = useState<string>('');

  // Debounce the free-text search so we don't hammer the API per keystroke.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);

  const filtersQ = useQuery({
    queryKey: ['audit', 'filters'],
    queryFn: auditApi.filters,
    staleTime: 60 * 1000,
  });

  const feed = useInfiniteQuery({
    queryKey: ['audit', 'feed', { debouncedQ, entityType, action, actor, from, to }],
    queryFn: ({ pageParam }) =>
      auditApi.list({
        q: debouncedQ || undefined,
        entityType: entityType || undefined,
        action: action || undefined,
        actor: actor || undefined,
        from: from || undefined,
        to: to || undefined,
        before: pageParam ?? undefined,
        limit: PAGE_SIZE,
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => (last.hasMore ? last.nextCursor ?? undefined : undefined),
    staleTime: 30 * 1000,
  });

  const items: AuditLogEntry[] = useMemo(
    () => feed.data?.pages.flatMap((p) => p.items) ?? [],
    [feed.data]
  );

  const [detail, setDetail] = useState<AuditLogEntry | null>(null);

  function clearFilters() {
    setQ('');
    setEntityType('');
    setAction('');
    setActor('');
    setFrom('');
    setTo('');
  }

  const filters = filtersQ.data;

  return (
    <PageContainer>
      <PageHeader
        title="Activity"
        subtitle={
          <span>
            Every action taken by users in this workspace — visible to{' '}
            <span className="font-medium text-slate-700">{canManage(role) ? 'managers and admins' : 'you'}</span>.
          </span>
        }
      />

      <div className="card p-4 mb-4 space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          <div className="lg:col-span-2">
            <label className="label">Search</label>
            <div className="relative">
              <Search size={16} className="absolute top-2.5 left-3 text-slate-400" />
              <input
                className="input pl-9"
                placeholder="Search by action or payload text…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            </div>
          </div>
          <div>
            <label className="label">Entity type</label>
            <select
              className="input"
              value={entityType}
              onChange={(e) => setEntityType(e.target.value)}
            >
              <option value="">Any</option>
              {(filters?.entityTypes ?? []).map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Action</label>
            <select
              className="input"
              value={action}
              onChange={(e) => setAction(e.target.value)}
            >
              <option value="">Any</option>
              {(filters?.actions ?? []).map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Actor</label>
            <select
              className="input"
              value={actor}
              onChange={(e) => setActor(e.target.value)}
            >
              <option value="">Anyone</option>
              {(filters?.actors ?? []).map((u) => (
                <option key={u.id} value={u.id}>
                  {u.fullName} {u.role ? `(${u.role})` : ''}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">From</label>
            <input
              type="date"
              className="input"
              value={from}
              max={to || undefined}
              onChange={(e) => setFrom(e.target.value)}
            />
          </div>
          <div>
            <label className="label">To</label>
            <input
              type="date"
              className="input"
              value={to}
              min={from || undefined}
              onChange={(e) => setTo(e.target.value)}
            />
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
          <div>
            Showing <span className="font-mono text-slate-700">{items.length}</span>
            {feed.hasNextPage ? '+' : ''} entries
            {(debouncedQ || entityType || action || actor || from || to) && (
              <span> · filters active</span>
            )}
          </div>
          <button
            type="button"
            className="btn-ghost text-xs"
            onClick={clearFilters}
            disabled={!q && !entityType && !action && !actor && !from && !to}
          >
            <X size={12} /> Clear filters
          </button>
        </div>
      </div>

      {/* The list itself */}
      <div className="card overflow-hidden">
        {feed.isLoading ? (
          <div className="p-6 flex items-center gap-2 text-sm text-slate-500">
            <Spinner /> Loading activity…
          </div>
        ) : items.length === 0 ? (
          <EmptyState
            title="No activity yet"
            description="Once your team starts using CrewLog, every create/update/delete they perform will appear here."
            icon={<Activity size={20} />}
          />
        ) : (
          <ul role="list" className="divide-y divide-slate-100">
            {items.map((entry) => (
              <ActivityRow
                key={entry.id}
                entry={entry}
                onOpenDetail={() => setDetail(entry)}
                onNavigate={(href) => navigate(href)}
              />
            ))}
          </ul>
        )}
        {feed.hasNextPage && (
          <div className="p-4 border-t border-slate-100 flex justify-center">
            <button
              className="btn-secondary"
              onClick={() => feed.fetchNextPage()}
              disabled={feed.isFetchingNextPage}
            >
              {feed.isFetchingNextPage ? (
                <>
                  <Loader2 size={14} className="animate-spin" /> Loading…
                </>
              ) : (
                <>
                  <ChevronDown size={14} /> Load older activity
                </>
              )}
            </button>
          </div>
        )}
      </div>

      {detail && <EntryDetailModal entry={detail} onClose={() => setDetail(null)} />}
    </PageContainer>
  );
}

// ---------------------------------------------------------------------------
// Row + detail rendering
// ---------------------------------------------------------------------------

function verbForAction(action: string): { verb: string; icon: LucideIcon } {
  // action is "entity.action", e.g. "work_log.create", "task.update",
  // "task_request.approve".
  const dot = action.lastIndexOf('.');
  const tail = dot >= 0 ? action.slice(dot + 1) : action;
  switch (tail) {
    case 'create':
      return { verb: 'created', icon: FilePlus2 };
    case 'update':
      return { verb: 'updated', icon: Edit3 };
    case 'delete':
      return { verb: 'deleted', icon: Trash2 };
    case 'archive':
      return { verb: 'archived', icon: Archive };
    case 'unarchive':
      return { verb: 'unarchived', icon: Archive };
    case 'approve':
      return { verb: 'approved', icon: Check };
    case 'reject':
      return { verb: 'rejected', icon: X };
    case 'cancel':
      return { verb: 'cancelled', icon: X };
    case 'assign':
      return { verb: 'reassigned', icon: UserPlus };
    case 'login':
      return { verb: 'signed in', icon: Mail };
    case 'logout':
      return { verb: 'signed out', icon: Mail };
    default:
      return { verb: tail, icon: ShieldAlert };
  }
}

function entityNoun(entityType: string): string {
  switch (entityType) {
    case 'work_log':
      return 'work log';
    case 'task':
      return 'task';
    case 'task_comment':
      return 'task comment';
    case 'task_request':
      return 'task request';
    case 'project':
      return 'project';
    case 'project_member':
      return 'project member';
    case 'customer':
      return 'customer';
    case 'document':
      return 'document';
    case 'folder':
      return 'folder';
    case 'capacity_override':
      return 'capacity override';
    case 'user':
      return 'user';
    default:
      return entityType.replace(/_/g, ' ');
  }
}

function actorLabel(entry: AuditLogEntry): string {
  return entry.actor?.fullName ?? 'System';
}

function ActivityRow({
  entry,
  onOpenDetail,
  onNavigate,
}: {
  entry: AuditLogEntry;
  onOpenDetail: () => void;
  onNavigate: (href: string) => void;
}) {
  const { verb, icon: Icon } = verbForAction(entry.action);
  const entityLabel = entry.entity?.label ?? entry.entityId ?? '—';
  const href = entry.entity?.href ?? null;
  const noun = entityNoun(entry.entityType);

  // Brief secondary line summarising the change.
  const summary = summarisePayload(entry);

  return (
    <li className="px-5 py-3 hover:bg-slate-50/60 transition flex items-start gap-3">
      <div className="flex-shrink-0 mt-0.5">
        {entry.actor ? (
          <Avatar name={entry.actor.fullName} src={entry.actor.avatarUrl} size="md" />
        ) : (
          <div className="w-9 h-9 rounded-full bg-slate-200 text-slate-500 grid place-items-center">
            <Icon size={16} />
          </div>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-sm text-slate-800">
          <span className="font-medium">{actorLabel(entry)}</span>{' '}
          <span className="text-slate-500">{verb} a</span>{' '}
          <span className="text-slate-700">{noun}</span>
          {entry.entity && (
            <>
              {' '}
              <span className="text-slate-500">—</span>{' '}
              {href ? (
                <button
                  type="button"
                  className="font-medium text-brand-700 hover:underline"
                  onClick={(e) => {
                    e.stopPropagation();
                    onNavigate(href);
                  }}
                >
                  {entityLabel}
                </button>
              ) : (
                <span className="font-medium text-slate-700">{entityLabel}</span>
              )}
            </>
          )}
          {!entry.entity && entry.entityId && (
            <>
              {' '}
              <span className="font-mono text-xs text-slate-500">{entry.entityId}</span>
            </>
          )}
        </div>
        {summary && <div className="mt-0.5 text-xs text-slate-600">{summary}</div>}
        <div className="mt-0.5 flex items-center gap-3 text-[11px] text-slate-400">
          <span title={formatDateTime(entry.createdAt)}>{fromNow(entry.createdAt)}</span>
          <span className="font-mono">{entry.action}</span>
          <button
            type="button"
            className="inline-flex items-center gap-1 hover:text-brand-600"
            onClick={(e) => {
              e.stopPropagation();
              onOpenDetail();
            }}
          >
            <LinkIcon size={11} /> details
          </button>
        </div>
      </div>
    </li>
  );
}

function summarisePayload(entry: AuditLogEntry): string | null {
  const p: any = entry.payload ?? {};
  if (entry.action.endsWith('.create')) {
    if (entry.entityType === 'work_log') {
      const a = p.after ?? {};
      return a.hours != null ? `Logged ${a.hours}h on ${a.date ?? '—'}` : null;
    }
    if (entry.entityType === 'project' && p.after?.name) {
      return `Created ${p.after.name}${p.after.code ? ` (${p.after.code})` : ''}`;
    }
    if (entry.entityType === 'task' && p.after?.title) {
      return `Created task ${p.after.title}${p.assigneeName ? ` · assigned to ${p.assigneeName}` : ''}`;
    }
    if (entry.entityType === 'task_request' && p.after?.title) {
      return `Requested: ${p.after.title}${p.after.priority ? ` · ${p.after.priority}` : ''}`;
    }
    if (entry.entityType === 'customer' && p.after?.name) {
      return `Created customer ${p.after.name}`;
    }
    if (entry.entityType === 'document' && p.after?.name) {
      return `Uploaded ${p.after.name}${p.after.sizeBytes ? ` · ${formatSize(p.after.sizeBytes)}` : ''}`;
    }
    if (entry.entityType === 'folder' && p.after?.name) {
      return `Created folder ${p.after.name}`;
    }
    if (entry.entityType === 'user' && p.after?.email) {
      return `Created user ${p.after.fullName ?? ''} (${p.after.email}) · ${p.after.role}`;
    }
  }

  if (entry.action.endsWith('.update') && p.diff) {
    const changes = Object.entries(p.diff as Record<string, { from: any; to: any }>);
    if (changes.length === 0) return null;
    const preview = changes
      .slice(0, 3)
      .map(([k, v]) => `${formatFieldName(k)}: ${formatValue(v.from)} → ${formatValue(v.to)}`)
      .join(', ');
    const extra = changes.length > 3 ? ` +${changes.length - 3} more` : '';
    return `${preview}${extra}`;
  }

  if (entry.action.endsWith('.delete')) {
    if (entry.entityType === 'project' && p.before?.name) return `Removed project ${p.before.name}`;
    if (entry.entityType === 'customer' && p.before?.name) return `Removed customer ${p.before.name}`;
    if (entry.entityType === 'document' && p.before?.name) return `Deleted ${p.before.name}`;
    if (entry.entityType === 'folder' && p.before?.name) return `Removed folder ${p.before.name}`;
    if (entry.entityType === 'user' && p.before?.email) {
      if (p.kind === 'deactivate') return `Deactivated ${p.before.fullName} (${p.before.email})`;
      return `Removed user ${p.before.fullName}`;
    }
    if (entry.entityType === 'work_log' && p.before?.hours != null) {
      return `${p.before.hours}h on ${p.before.date ?? '—'}`;
    }
  }

  if (entry.action.endsWith('.approve') && entry.entityType === 'task_request') {
    return p.createdTaskTitle
      ? `Approved & created task “${p.createdTaskTitle}”`
      : p.createdTaskId
      ? `Approved & created task #${p.createdTaskId.slice(0, 8)}…`
      : 'Approved';
  }
  if (entry.action.endsWith('.reject') && entry.entityType === 'task_request') {
    return `Rejected${p.reviewerNote ? ` — “${truncate(p.reviewerNote, 80)}”` : ''}`;
  }
  if (entry.action.endsWith('.cancel') && entry.entityType === 'task_request') {
    return `Cancelled request`;
  }
  if (entry.action.endsWith('.archive')) {
    return `Archived`;
  }
  if (entry.action.endsWith('.unarchive')) {
    return `Unarchived`;
  }
  if (entry.action.endsWith('.create') && entry.entityType === 'task_comment') {
    if (p.bodyPreview) return `“${truncate(p.bodyPreview, 80)}”`;
  }

  return null;
}

function truncate(s: string, n: number) {
  if (!s) return '';
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

function formatValue(v: any): string {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : v.toFixed(2);
  if (typeof v === 'boolean') return v ? 'yes' : 'no';
  if (typeof v === 'string') return v.length > 32 ? `${v.slice(0, 31)}…` : v;
  try {
    return JSON.stringify(v).slice(0, 40);
  } catch {
    return String(v);
  }
}

function formatFieldName(f: string): string {
  // "task_id" → "task", "due_date" → "due date".
  const cleaned = f.replace(/_id$/, '').replace(/_/g, ' ');
  return cleaned || f;
}

function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const v = bytes / Math.pow(1024, i);
  return `${v < 10 && i > 0 ? v.toFixed(1) : Math.round(v)} ${units[i]}`;
}

function EntryDetailModal({
  entry,
  onClose,
}: {
  entry: AuditLogEntry;
  onClose: () => void;
}) {
  return (
    <Modal open onClose={onClose} title="Activity details" size="md">
      <div className="space-y-4">
        <div className="flex items-start gap-3">
          {entry.actor ? (
            <Avatar name={entry.actor.fullName} src={entry.actor.avatarUrl} size="lg" />
          ) : (
            <div className="w-12 h-12 rounded-full bg-slate-200 grid place-items-center text-slate-500">
              <ShieldAlert size={18} />
            </div>
          )}
          <div className="min-w-0">
            <div className="text-base font-semibold text-slate-800">
              {actorLabel(entry)}
              {entry.actor?.role && (
                <span className="ml-2 text-xs text-slate-500 capitalize">({entry.actor.role})</span>
              )}
            </div>
            <div className="text-xs text-slate-500 truncate">{entry.actor?.email ?? '—'}</div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <div className="text-xs uppercase text-slate-500">Action</div>
            <div className="font-mono text-slate-800">{entry.action}</div>
          </div>
          <div>
            <div className="text-xs uppercase text-slate-500">Entity type</div>
            <div className="text-slate-800">{entry.entityType}</div>
          </div>
          <div>
            <div className="text-xs uppercase text-slate-500">Entity</div>
            <div className="text-slate-800 truncate">
              {entry.entity?.label ?? (
                <span className="font-mono text-xs">
                  {entry.entityId ?? '—'}
                </span>
              )}
            </div>
          </div>
          <div>
            <div className="text-xs uppercase text-slate-500">When</div>
            <div className="text-slate-800">{formatDateTime(entry.createdAt)}</div>
          </div>
        </div>

        <div>
          <div className="text-xs uppercase text-slate-500 mb-1">Details</div>
          <pre
            className={clsx(
              'text-xs bg-slate-900 text-slate-100 rounded-lg p-3 overflow-x-auto',
              'whitespace-pre-wrap break-words'
            )}
          >
            {JSON.stringify(entry.payload ?? {}, null, 2)}
          </pre>
        </div>

        <div className="flex justify-end">
          <button className="btn-secondary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </Modal>
  );
}

// Silence an unused-export warning that may be raised in stricter configs.
void Plus;
void FolderPlus;
