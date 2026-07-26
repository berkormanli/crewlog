import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import toast from 'react-hot-toast';
import { usersApi } from '@/api';
import { PageContainer, PageHeader, Avatar } from '@/components/Avatar';
import { Spinner } from '@/components/Spinner';
import { EmptyState } from '@/components/EmptyState';
import { Modal } from '@/components/Modal';
import type { UserSummary } from '@/types';
import { fromNow } from '@/lib/format';

const schema = z.object({
  email: z.string().email(),
  fullName: z.string().min(1).max(200),
  role: z.enum(['worker', 'manager', 'admin']),
  password: z.string().min(8),
});

type FormValues = z.infer<typeof schema>;

export default function UsersAdminPage() {
  const qc = useQueryClient();
  const usersQ = useQuery({ queryKey: ['users'], queryFn: usersApi.list });
  const [showCreate, setShowCreate] = useState(false);

  const deactivate = useMutation({
    mutationFn: (id: string) => usersApi.deactivate(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] });
      toast.success('Deactivated');
    },
  });

  return (
    <PageContainer>
      <PageHeader
        title="Users"
        subtitle="Manage team members and their roles"
        actions={
          <button className="btn-primary" onClick={() => setShowCreate(true)}>
            <Plus size={16} /> Invite user
          </button>
        }
      />

      {usersQ.isLoading ? (
        <div className="flex items-center gap-2 text-slate-500 text-sm">
          <Spinner /> Loading…
        </div>
      ) : !usersQ.data || usersQ.data.length === 0 ? (
        <EmptyState title="No users yet" />
      ) : (
        <div className="card overflow-hidden">
          <table className="min-w-full divide-y divide-slate-100 text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-5 py-3 text-left font-medium">Name</th>
                <th className="px-5 py-3 text-left font-medium">Email</th>
                <th className="px-5 py-3 text-left font-medium">Role</th>
                <th className="px-5 py-3 text-left font-medium">Last login</th>
                <th className="px-5 py-3 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {usersQ.data.map((u) => (
                <UserRow
                  key={u.id}
                  user={u}
                  onDeactivate={() => {
                    if (confirm(`Deactivate ${u.fullName}?`)) deactivate.mutate(u.id);
                  }}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showCreate && (
        <CreateUserModal onClose={() => setShowCreate(false)} />
      )}
    </PageContainer>
  );
}

function UserRow({ user, onDeactivate }: { user: UserSummary; onDeactivate: () => void }) {
  const [editing, setEditing] = useState(false);
  return (
    <>
      <tr className="hover:bg-slate-50">
        <td className="px-5 py-3">
          <div className="flex items-center gap-2">
            <Avatar name={user.fullName} size="sm" src={user.avatarUrl} />
            <span className="font-medium text-slate-800">{user.fullName}</span>
            {!user.isActive && <span className="badge-gray">Inactive</span>}
          </div>
        </td>
        <td className="px-5 py-3 text-slate-600">{user.email}</td>
        <td className="px-5 py-3">
          <span className="badge-blue capitalize">{user.role}</span>
        </td>
        <td className="px-5 py-3 text-slate-500">
          {user.lastLoginAt ? fromNow(user.lastLoginAt) : '—'}
        </td>
        <td className="px-5 py-3 text-right">
          <div className="inline-flex items-center gap-2">
            {user.isActive && (
              <button
                className="btn-ghost text-xs"
                onClick={() => setEditing(true)}
                title="Edit user"
              >
                <Pencil size={14} /> Edit
              </button>
            )}
            {user.isActive && (
              <button className="btn-ghost text-red-600 text-xs" onClick={onDeactivate}>
                <Trash2 size={14} /> Deactivate
              </button>
            )}
          </div>
        </td>
      </tr>
      {editing && (
        <EditUserModal user={user} onClose={() => setEditing(false)} />
      )}
    </>
  );
}

function EditUserModal({ user, onClose }: { user: UserSummary; onClose: () => void }) {
  const qc = useQueryClient();
  const [fullName, setFullName] = useState(user.fullName);
  const mut = useMutation({
    mutationFn: () =>
      usersApi.update(user.id, { fullName }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] });
      toast.success('Updated');
      onClose();
    },
    onError: (e: any) => toast.error(e?.message ?? 'Failed'),
  });
  return (
    <Modal open onClose={onClose} title={`Edit ${user.fullName}`}>
      <div className="space-y-4">
        <div>
          <label className="label">Full name</label>
          <input
            className="input"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
          />
        </div>
        <div className="flex justify-end gap-2">
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={() => mut.mutate()} disabled={mut.isPending}>
            {mut.isPending ? <Spinner /> : 'Save'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function CreateUserModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const { register, handleSubmit, formState: { errors } } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { email: '', fullName: '', role: 'worker', password: '' },
  });
  const mut = useMutation({
    mutationFn: (data: FormValues) => usersApi.create(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] });
      toast.success('User created');
      onClose();
    },
    onError: (e: any) => toast.error(e?.message ?? 'Failed'),
  });
  return (
    <Modal open onClose={onClose} title="Invite a new user">
      <form onSubmit={handleSubmit((d) => mut.mutate(d))} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Full name</label>
            <input className="input" {...register('fullName')} />
            {errors.fullName && <p className="text-xs text-red-600">{errors.fullName.message}</p>}
          </div>
          <div>
            <label className="label">Email</label>
            <input type="email" className="input" {...register('email')} />
            {errors.email && <p className="text-xs text-red-600">{errors.email.message}</p>}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Role</label>
            <select className="input" {...register('role')}>
              <option value="worker">Worker</option>
              <option value="manager">Manager</option>
              <option value="admin">Admin</option>
            </select>
          </div>
          <div>
            <label className="label">Temporary password</label>
            <input type="text" className="input font-mono" {...register('password')} />
            {errors.password && <p className="text-xs text-red-600">{errors.password.message}</p>}
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn-primary" disabled={mut.isPending}>Create user</button>
        </div>
      </form>
    </Modal>
  );
}
