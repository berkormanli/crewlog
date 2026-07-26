import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Building2, Plus, FolderKanban } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { customersApi, projectsApi } from '@/api';
import { PageContainer, PageHeader } from '@/components/Avatar';
import { Spinner } from '@/components/Spinner';
import { EmptyState } from '@/components/EmptyState';
import { Modal } from '@/components/Modal';
import { formatDate } from '@/lib/format';
import { useAuthStore } from '@/stores/auth';
import { canManage } from '@/lib/rbac';
import toast from 'react-hot-toast';

const schema = z.object({
  name: z.string().min(1).max(200),
  code: z.string().min(1).max(50).regex(/^[a-z0-9-]+$/i, 'letters, numbers, hyphens only'),
  description: z.string().max(2000).optional(),
  status: z.enum(['active', 'paused', 'archived']).default('active'),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#3b82f6'),
  clientName: z.string().max(200).optional(),
  customerId: z.string().uuid().optional(),
});

type FormValues = z.infer<typeof schema>;

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6'];

export default function ProjectsListPage() {
  const user = useAuthStore((s) => s.user)!;
  const projectsQ = useQuery({ queryKey: ['projects'], queryFn: projectsApi.list });
  const [showCreate, setShowCreate] = useState(false);
  const [customerFilter, setCustomerFilter] = useState<string>('');

  const customersQ = useQuery({ queryKey: ['customers'], queryFn: () => customersApi.list() });

  return (
    <PageContainer>
      <PageHeader
        title="Projects"
        subtitle="All projects in your organization"
        actions={
          canManage(user.role) ? (
            <button className="btn-primary" onClick={() => setShowCreate(true)}>
              <Plus size={16} /> New project
            </button>
          ) : null
        }
      />

      <div className="card p-3 mb-4 flex items-center gap-3">
        <label className="text-xs text-slate-500 whitespace-nowrap">Filter by customer</label>
        <select
          className="input max-w-[320px]"
          value={customerFilter}
          onChange={(e) => setCustomerFilter(e.target.value)}
        >
          <option value="">All customers</option>
          <option value="__none__">— No customer —</option>
          {customersQ.data?.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
        <span className="ml-auto text-xs text-slate-400">
          {projectsQ.data?.length ?? 0} project(s)
        </span>
      </div>

      {projectsQ.isLoading ? (
        <div className="flex items-center gap-2 text-slate-500 text-sm">
          <Spinner /> Loading…
        </div>
      ) : (() => {
        const filtered = (projectsQ.data ?? []).filter((p) => {
          if (!customerFilter) return true;
          if (customerFilter === '__none__') return !p.customerId;
          return p.customerId === customerFilter;
        });
        if (filtered.length === 0) {
          return (
            <EmptyState
              icon={<FolderKanban size={28} />}
              title="No projects match"
              description="Try clearing the customer filter, or create a new project."
            />
          );
        }
        return (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((p) => (
            <Link
              key={p.id}
              to={`/projects/${p.id}`}
              className="card p-5 hover:shadow-md transition group"
            >
              <div className="flex items-start justify-between mb-3">
                <span
                  className="w-3 h-12 rounded-full flex-shrink-0"
                  style={{ background: p.color }}
                />
                <div className="flex-1 ml-3 min-w-0">
                  <div className="font-semibold text-slate-800 group-hover:text-brand-700 truncate">
                    {p.name}
                  </div>
                  <div className="text-xs text-slate-500 font-mono mt-1">{p.code}</div>
                </div>
                <span
                  className={
                    p.status === 'active'
                      ? 'badge-green'
                      : p.status === 'paused'
                      ? 'badge-yellow'
                      : 'badge-gray'
                  }
                >
                  {p.status}
                </span>
              </div>
              {p.description && (
                <p className="text-sm text-slate-600 line-clamp-2">{p.description}</p>
              )}
              <div className="mt-4 text-xs text-slate-500 space-y-1">
                <div className="min-w-0">
                  {p.customer ? (
                    <Link
                      to={`/customers/${p.customer.id}`}
                      onClick={(e) => e.stopPropagation()}
                      className="inline-flex items-center gap-1 text-slate-600 hover:text-brand-700 truncate"
                      title={`Customer: ${p.customer.name}`}
                    >
                      <Building2 size={12} /> {p.customer.name}
                    </Link>
                  ) : (
                    <span className="text-slate-400">{p.clientName ?? 'No customer'}</span>
                  )}
                </div>
                <div className="whitespace-nowrap">
                  {p.startDate ? formatDate(p.startDate) : '—'} →{' '}
                  {p.endDate ? formatDate(p.endDate) : '—'}
                </div>
              </div>
            </Link>
          ))}
        </div>
        );
      })()}

      {showCreate && canManage(user.role) && (
        <CreateProjectModal onClose={() => setShowCreate(false)} />
      )}
    </PageContainer>
  );
}

function CreateProjectModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const customersQ = useQuery({ queryKey: ['customers'], queryFn: () => customersApi.list() });
  const { register, handleSubmit, formState: { errors }, setValue, watch } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: '',
      code: '',
      description: '',
      status: 'active',
      color: '#3b82f6',
      clientName: '',
      customerId: undefined as any,
    },
  });
  const color = watch('color');
  const customerId = watch('customerId');

  const mut = useMutation({
    mutationFn: (data: FormValues) =>
      projectsApi.create({
        name: data.name,
        code: data.code,
        description: data.description,
        status: data.status,
        startDate: data.startDate,
        endDate: data.endDate,
        color: data.color,
        clientName: data.clientName,
        customerId: data.customerId || null,
      } as any),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['projects'] });
      qc.invalidateQueries({ queryKey: ['customers'] });
      toast.success('Project created');
      onClose();
    },
    onError: (e: any) => toast.error(e?.message ?? 'Failed'),
  });

  return (
    <Modal open onClose={onClose} title="Create a new project" size="lg">
      <form onSubmit={handleSubmit((d) => mut.mutate(d))} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Name</label>
            <input className="input" {...register('name')} />
            {errors.name && <p className="text-xs text-red-600">{errors.name.message}</p>}
          </div>
          <div>
            <label className="label">Code (short slug)</label>
            <input className="input font-mono" {...register('code')} placeholder="RTB-2026" />
            {errors.code && <p className="text-xs text-red-600">{errors.code.message}</p>}
          </div>
        </div>
        <div>
          <label className="label">Description</label>
          <textarea rows={3} className="input" {...register('description')} />
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div>
            <label className="label">Status</label>
            <select className="input" {...register('status')}>
              <option value="active">Active</option>
              <option value="paused">Paused</option>
              <option value="archived">Archived</option>
            </select>
          </div>
          <div>
            <label className="label">Start date</label>
            <input type="date" className="input" {...register('startDate')} />
          </div>
          <div>
            <label className="label">End date</label>
            <input type="date" className="input" {...register('endDate')} />
          </div>
          <div>
            <label className="label">Color</label>
            <div className="flex flex-wrap gap-1.5">
              {COLORS.map((c) => (
                <button
                  type="button"
                  key={c}
                  onClick={() => setValue('color', c)}
                  className={`w-7 h-7 rounded-full border-2 ${color === c ? 'border-slate-900' : 'border-transparent'}`}
                  style={{ background: c }}
                  aria-label={c}
                />
              ))}
            </div>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Customer</label>
            <select
              className="input"
              value={customerId ?? ''}
              onChange={(e) => setValue('customerId', e.target.value || undefined)}
            >
              <option value="">— None —</option>
              {customersQ.data?.filter((c) => c.status === 'active').map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            <p className="text-xs text-slate-500 mt-1">
              Bind this project to a customer so you can filter &amp; report by client.
            </p>
          </div>
          <div>
            <label className="label">Free-text client (fallback)</label>
            <input className="input" {...register('clientName')} placeholder="only if no customer" />
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn-primary" disabled={mut.isPending}>
            Create project
          </button>
        </div>
      </form>
    </Modal>
  );
}
