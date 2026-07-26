import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Building2, Plus, Search } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import toast from 'react-hot-toast';
import { customersApi } from '@/api';
import { PageContainer, PageHeader } from '@/components/Avatar';
import { Spinner } from '@/components/Spinner';
import { EmptyState } from '@/components/EmptyState';
import { Modal } from '@/components/Modal';
import { fromNow } from '@/lib/format';
import { useAuthStore } from '@/stores/auth';
import { canManage } from '@/lib/rbac';
import type { Customer } from '@/types';

const schema = z.object({
  name: z.string().min(1).max(200),
  code: z.string().max(50).optional(),
  contactName: z.string().max(200).optional(),
  contactEmail: z.string().email().optional().or(z.literal('')),
  contactPhone: z.string().max(50).optional(),
  address: z.string().max(500).optional(),
  notes: z.string().max(5000).optional(),
  status: z.enum(['active', 'archived']).default('active'),
});

type FormValues = z.infer<typeof schema>;

export default function CustomersListPage() {
  const user = useAuthStore((s) => s.user)!;
  const [q, setQ] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState<Customer | null>(null);

  const customersQ = useQuery({
    queryKey: ['customers', { q, status: statusFilter }],
    queryFn: () => customersApi.list({ q: q || undefined, status: statusFilter || undefined }),
  });

  return (
    <PageContainer>
      <PageHeader
        title="Customers"
        subtitle="The businesses / external parties we do projects for"
        actions={
          canManage(user.role) ? (
            <button className="btn-primary" onClick={() => setShowCreate(true)}>
              <Plus size={16} /> New customer
            </button>
          ) : null
        }
      />

      <div className="card p-4 mb-4 flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[220px]">
          <label className="label">Search</label>
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              className="input pl-8"
              placeholder="name, code, contact…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
        </div>
        <div className="w-[180px]">
          <label className="label">Status</label>
          <select className="input" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">All</option>
            <option value="active">Active</option>
            <option value="archived">Archived</option>
          </select>
        </div>
      </div>

      {customersQ.isLoading ? (
        <div className="flex items-center gap-2 text-slate-500 text-sm">
          <Spinner /> Loading…
        </div>
      ) : !customersQ.data || customersQ.data.length === 0 ? (
        <EmptyState
          icon={<Building2 size={28} />}
          title="No customers yet"
          description={
            canManage(user.role)
              ? 'Add a customer to bind projects to them.'
              : 'No customers are set up in your organization yet.'
          }
        />
      ) : (
        <div className="card overflow-hidden">
          <table className="min-w-full divide-y divide-slate-100 text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-5 py-3 text-left font-medium">Name</th>
                <th className="px-5 py-3 text-left font-medium">Code</th>
                <th className="px-5 py-3 text-left font-medium">Contact</th>
                <th className="px-5 py-3 text-left font-medium">Status</th>
                <th className="px-5 py-3 text-left font-medium">Updated</th>
                <th className="px-5 py-3 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {customersQ.data.map((c) => (
                <CustomerRow
                  key={c.id}
                  customer={c}
                  canManage={canManage(user.role)}
                  onEdit={() => setEditing(c)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showCreate && <CustomerModal onClose={() => setShowCreate(false)} />}
      {editing && <CustomerModal customer={editing} onClose={() => setEditing(null)} />}
    </PageContainer>
  );
}

function CustomerRow({
  customer,
  canManage,
  onEdit,
}: {
  customer: Customer;
  canManage: boolean;
  onEdit: () => void;
}) {
  const qc = useQueryClient();
  const deleteMut = useMutation({
    mutationFn: () => customersApi.remove(customer.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['customers'] });
      toast.success('Customer deleted');
    },
    onError: (e: any) => toast.error(e?.message ?? 'Failed to delete'),
  });
  return (
    <tr className="hover:bg-slate-50">
      <td className="px-5 py-3">
        <Link
          to={`/customers/${customer.id}`}
          className="font-medium text-slate-900 hover:underline"
        >
          {customer.name}
        </Link>
      </td>
      <td className="px-5 py-3 font-mono text-slate-600 text-xs">{customer.code ?? '—'}</td>
      <td className="px-5 py-3 text-slate-600">
        <div>{customer.contactName ?? '—'}</div>
        {customer.contactEmail && (
          <div className="text-xs text-slate-500">{customer.contactEmail}</div>
        )}
      </td>
      <td className="px-5 py-3">
        <span className={customer.status === 'active' ? 'badge-green' : 'badge-gray'}>
          {customer.status}
        </span>
      </td>
      <td className="px-5 py-3 text-slate-500">{fromNow(customer.updatedAt)}</td>
      <td className="px-5 py-3 text-right">
        {canManage && (
          <div className="inline-flex items-center gap-2">
            <button className="btn-ghost text-xs" onClick={onEdit}>
              Edit
            </button>
            <button
              className="btn-ghost text-xs text-red-600"
              onClick={() => {
                if (
                  confirm(
                    `Delete ${customer.name}? Any projects still bound to this customer must be unbound first.`
                  )
                ) {
                  deleteMut.mutate();
                }
              }}
            >
              Delete
            </button>
          </div>
        )}
      </td>
    </tr>
  );
}

function CustomerModal({
  customer,
  onClose,
}: {
  customer?: Customer;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const isEdit = Boolean(customer);
  const { register, handleSubmit, formState: { errors } } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: customer?.name ?? '',
      code: customer?.code ?? '',
      contactName: customer?.contactName ?? '',
      contactEmail: customer?.contactEmail ?? '',
      contactPhone: customer?.contactPhone ?? '',
      address: customer?.address ?? '',
      notes: customer?.notes ?? '',
      status: (customer?.status as 'active' | 'archived') ?? 'active',
    },
  });

  const mut = useMutation({
    mutationFn: (data: FormValues) => {
      const payload: Record<string, unknown> = {
        name: data.name,
        code: data.code || undefined,
        contactName: data.contactName || undefined,
        contactEmail: data.contactEmail || undefined,
        contactPhone: data.contactPhone || undefined,
        address: data.address || undefined,
        notes: data.notes || undefined,
        status: data.status,
      };
      return isEdit
        ? customersApi.update(customer!.id, payload as Partial<Customer>)
        : customersApi.create(payload as Partial<Customer>);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['customers'] });
      qc.invalidateQueries({ queryKey: ['projects'] });
      toast.success(isEdit ? 'Customer updated' : 'Customer created');
      onClose();
    },
    onError: (e: any) => toast.error(e?.message ?? 'Failed to save'),
  });

  return (
    <Modal open onClose={onClose} title={isEdit ? `Edit ${customer!.name}` : 'Create a new customer'} size="lg">
      <form onSubmit={handleSubmit((d) => mut.mutate(d))} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Name *</label>
            <input className="input" {...register('name')} />
            {errors.name && <p className="text-xs text-red-600 mt-1">{errors.name.message}</p>}
          </div>
          <div>
            <label className="label">Code (short slug)</label>
            <input className="input font-mono" {...register('code')} placeholder="ACME" />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Contact name</label>
            <input className="input" {...register('contactName')} />
          </div>
          <div>
            <label className="label">Contact phone</label>
            <input className="input" {...register('contactPhone')} />
          </div>
        </div>
        <div>
          <label className="label">Contact email</label>
          <input type="email" className="input" {...register('contactEmail')} />
          {errors.contactEmail && (
            <p className="text-xs text-red-600 mt-1">{errors.contactEmail.message}</p>
          )}
        </div>
        <div>
          <label className="label">Address</label>
          <input className="input" {...register('address')} />
        </div>
        <div>
          <label className="label">Notes</label>
          <textarea rows={3} className="input" {...register('notes')} />
        </div>

        <div className="flex items-center gap-3">
          <label className="label mb-0">Status</label>
          <select className="input max-w-[180px]" {...register('status')}>
            <option value="active">Active</option>
            <option value="archived">Archived</option>
          </select>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn-primary" disabled={mut.isPending}>
            {mut.isPending ? <Spinner /> : isEdit ? 'Save changes' : 'Create customer'}
          </button>
        </div>
      </form>
    </Modal>
  );
}