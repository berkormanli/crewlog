import { Link, useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { customersApi } from '@/api';
import { PageContainer, PageHeader } from '@/components/Avatar';
import { Spinner } from '@/components/Spinner';
import { formatDate } from '@/lib/format';

export default function CustomerDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const customerQ = useQuery({
    queryKey: ['customer', id],
    queryFn: () => customersApi.get(id),
  });

  if (customerQ.isLoading) {
    return (
      <PageContainer>
        <div className="flex items-center gap-2 text-slate-500 text-sm">
          <Spinner /> Loading…
        </div>
      </PageContainer>
    );
  }
  if (customerQ.isError || !customerQ.data) {
    return (
      <PageContainer>
        <button onClick={() => navigate(-1)} className="btn-ghost">
          ← Back
        </button>
        <p className="text-sm text-red-600 mt-4">Customer not found.</p>
      </PageContainer>
    );
  }

  const c = customerQ.data;
  return (
    <PageContainer>
      <div className="mb-4">
        <Link to="/customers" className="btn-ghost">
          ← All customers
        </Link>
      </div>
      <PageHeader
        title={c.name}
        subtitle={
          <span className="font-mono text-xs text-slate-500">
            {c.code ?? '—'} · {c.status === 'active' ? 'Active' : 'Archived'}
          </span>
        }
      />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="card p-5 md:col-span-2 space-y-3">
          <h3 className="text-sm font-semibold text-slate-700">Contact</h3>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <Kv label="Contact name" value={c.contactName ?? '—'} />
            <Kv label="Email" value={c.contactEmail ?? '—'} />
            <Kv label="Phone" value={c.contactPhone ?? '—'} />
            <Kv label="Address" value={c.address ?? '—'} />
          </div>
          {c.notes && (
            <>
              <h3 className="text-sm font-semibold text-slate-700 mt-4">Notes</h3>
              <p className="text-sm text-slate-700 whitespace-pre-wrap">{c.notes}</p>
            </>
          )}
        </div>

        <div className="card p-5">
          <h3 className="text-sm font-semibold text-slate-700 mb-3">
            Projects ({c.projects?.length ?? 0})
          </h3>
          {c.projects && c.projects.length > 0 ? (
            <ul className="space-y-2 text-sm">
              {c.projects.map((p) => (
                <li key={p.id}>
                  <Link
                    to={`/projects/${p.id}`}
                    className="flex items-center gap-2 hover:bg-slate-50 -mx-2 px-2 py-1 rounded"
                  >
                    <span
                      className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                      style={{ background: p.color }}
                    />
                    <span className="font-medium text-slate-800 truncate">{p.name}</span>
                    <span className="text-xs text-slate-500 font-mono ml-auto">{p.code}</span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-slate-400 italic">
              No projects bound to this customer yet.
            </p>
          )}
        </div>

        <div className="card p-5">
          <h3 className="text-sm font-semibold text-slate-700 mb-3">Details</h3>
          <div className="space-y-2 text-sm">
            <Kv label="Status" value={
              <span className={c.status === 'active' ? 'badge-green' : 'badge-gray'}>{c.status}</span>
            } />
            <Kv label="Created" value={formatDate(c.createdAt)} />
            <Kv label="Updated" value={formatDate(c.updatedAt)} />
          </div>
        </div>
      </div>
    </PageContainer>
  );
}

function Kv({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs text-slate-500">{label}</div>
      <div className="text-slate-800 font-medium mt-0.5">{value}</div>
    </div>
  );
}