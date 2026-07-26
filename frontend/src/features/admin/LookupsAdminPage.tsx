import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ClipboardList, Cog, MapPin, Pencil, Plus, Trash2 } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import toast from 'react-hot-toast';
import { workActivityTypesApi, workLocationsApi, workModulesApi } from '@/api';
import { PageContainer, PageHeader } from '@/components/Avatar';
import { Modal } from '@/components/Modal';
import { Spinner } from '@/components/Spinner';
import { EmptyState } from '@/components/EmptyState';
import { canManage } from '@/lib/rbac';
import { useAuthStore } from '@/stores/auth';
import type { LookupOption } from '@/types';
import { LOOKUP_OTHER } from '@/types';

/**
 * Admin page for managing the tenant's curated lists of SAP modules,
 * activity types, and work locations. Default rows are seeded by migrations
 * and can't be deleted — they're the built-in vocabulary all users start from.
 */
export default function LookupsAdminPage() {
  const user = useAuthStore((s) => s.user)!;
  const [tab, setTab] = useState<'modules' | 'activities' | 'locations'>('modules');

  if (!canManage(user.role)) {
    return (
      <PageContainer>
        <PageHeader title="Lookups" subtitle="Manager+ only" />
        <p className="text-sm text-slate-500">You need manager or admin role to manage lookups.</p>
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      <PageHeader
        title="Work lookups"
        subtitle="Curate SAP modules, activity types, and locations for work logs"
        actions={
          <div className="card flex items-center p-1 gap-1">
            <button
              onClick={() => setTab('modules')}
              className={`px-3 py-1 text-sm rounded-md transition inline-flex items-center gap-1.5 ${
                tab === 'modules' ? 'bg-slate-100 text-slate-900 font-medium' : 'text-slate-600 hover:bg-slate-50'
              }`}
            >
              <Cog size={14} /> Modules
            </button>
            <button
              onClick={() => setTab('activities')}
              className={`px-3 py-1 text-sm rounded-md transition inline-flex items-center gap-1.5 ${
                tab === 'activities' ? 'bg-slate-100 text-slate-900 font-medium' : 'text-slate-600 hover:bg-slate-50'
              }`}
            >
              <ClipboardList size={14} /> Activity types
            </button>
            <button
              onClick={() => setTab('locations')}
              className={`px-3 py-1 text-sm rounded-md transition inline-flex items-center gap-1.5 ${
                tab === 'locations' ? 'bg-slate-100 text-slate-900 font-medium' : 'text-slate-600 hover:bg-slate-50'
              }`}
            >
              <MapPin size={14} /> Locations
            </button>
          </div>
        }
      />
      {tab === 'modules' ? <ModuleManager /> : tab === 'activities' ? <ActivityTypeManager /> : <LocationManager />}
    </PageContainer>
  );
}

const schema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(100),
});

function ModuleManager() {
  return <LookupManager api={workModulesApi} queryKey="work-modules" title="module" icon={<Cog size={14} />} />;
}

function ActivityTypeManager() {
  return <LookupManager api={workActivityTypesApi} queryKey="work-activity-types" title="activity type" icon={<ClipboardList size={14} />} />;
}

function LocationManager() {
  return <LookupManager api={workLocationsApi} queryKey="work-locations" title="location" icon={<MapPin size={14} />} />;
}

function LookupManager({
  api,
  queryKey,
  title,
  icon,
}: {
  api: {
    list: () => Promise<LookupOption[]>;
    create: (name: string) => Promise<LookupOption>;
    update: (id: string, name: string) => Promise<LookupOption>;
    remove: (id: string) => Promise<{ ok: true }>;
  };
  queryKey: 'work-modules' | 'work-activity-types' | 'work-locations';
  title: string;
  icon: React.ReactNode;
}) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: [queryKey], queryFn: api.list });
  const [editing, setEditing] = useState<LookupOption | null>(null);
  const [creating, setCreating] = useState(false);

  const remove = useMutation({
    mutationFn: (id: string) => api.remove(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [queryKey] });
      toast.success('Removed');
    },
    onError: (e: any) => toast.error(e?.message ?? 'Failed'),
  });

  return (
    <div className="card overflow-hidden">
      <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between">
        <div className="text-sm text-slate-600">
          <span className="font-medium text-slate-700">{(q.data ?? []).length}</span> {title}(s) total
        </div>
        <button className="btn-primary text-sm" onClick={() => setCreating(true)}>
          <Plus size={14} /> New {title}
        </button>
      </div>
      {q.isLoading ? (
        <div className="p-6 flex items-center gap-2 text-slate-500 text-sm">
          <Spinner /> Loading…
        </div>
      ) : (q.data ?? []).length === 0 ? (
        <EmptyState title={`No ${title}s yet`} />
      ) : (
        <table className="min-w-full divide-y divide-slate-100 text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-5 py-3 text-left font-medium">Name</th>
              <th className="px-5 py-3 text-left font-medium">Source</th>
              <th className="px-5 py-3 text-right font-medium">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {(q.data ?? []).map((o) => (
              <tr key={o.id} className="hover:bg-slate-50">
                <td className="px-5 py-3 flex items-center gap-2">
                  <span className="text-slate-400">{icon}</span>
                  <span className="font-medium text-slate-800">{o.name}</span>
                </td>
                <td className="px-5 py-3 text-slate-500">
                  {o.isDefault ? (
                    <span className="badge-blue">Built-in</span>
                  ) : (
                    <span className="badge-gray">Custom</span>
                  )}
                </td>
                <td className="px-5 py-3 text-right">
                  <button
                    className="btn-ghost text-xs"
                    onClick={() => setEditing(o)}
                  >
                    <Pencil size={14} /> Rename
                  </button>
                  {!o.isDefault && (
                    <button
                      className="btn-ghost text-xs text-red-600"
                      onClick={() => {
                        if (confirm(`Remove "${o.name}"?`)) remove.mutate(o.id);
                      }}
                    >
                      <Trash2 size={14} /> Remove
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {creating && (
        <LookupEditModal
          title={`New ${title}`}
          onClose={() => setCreating(false)}
          onSubmit={async (name) => {
            try {
              await api.create(name);
              qc.invalidateQueries({ queryKey: [queryKey] });
              toast.success('Saved');
              setCreating(false);
            } catch (e: any) {
              toast.error(e?.message ?? 'Failed');
            }
          }}
        />
      )}
      {editing && (
        <LookupEditModal
          title={`Rename ${title}`}
          initialName={editing.name}
          onClose={() => setEditing(null)}
          onSubmit={async (name) => {
            try {
              await api.update(editing.id, name);
              qc.invalidateQueries({ queryKey: [queryKey] });
              toast.success('Saved');
              setEditing(null);
            } catch (e: any) {
              toast.error(e?.message ?? 'Failed');
            }
          }}
        />
      )}
    </div>
  );
}

function LookupEditModal({
  title,
  initialName,
  onClose,
  onSubmit,
}: {
  title: string;
  initialName?: string;
  onClose: () => void;
  onSubmit: (name: string) => Promise<void>;
}) {
  const { register, handleSubmit, formState: { errors } } = useForm<{ name: string }>({
    resolver: zodResolver(schema),
    defaultValues: { name: initialName ?? '' },
  });
  return (
    <Modal open onClose={onClose} title={title}>
      <form onSubmit={handleSubmit((d) => onSubmit(d.name.trim()))} className="space-y-3">
        <div>
          <label className="label">Name</label>
          <input className="input" autoFocus placeholder={`e.g. ${title === 'module' ? 'MM' : title === 'activity type' ? 'Support' : 'Office'}`} {...register('name')} />
          {errors.name && <p className="text-xs text-red-600">{errors.name.message}</p>}
          <p className="text-xs text-slate-500 mt-1">
            Cannot be the reserved name <code>{LOOKUP_OTHER}</code> (that's the
            "Other…" free-text option in the dropdown).
          </p>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn-primary">Save</button>
        </div>
      </form>
    </Modal>
  );
}
