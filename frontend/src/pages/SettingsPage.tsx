import { useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useQueryClient } from '@tanstack/react-query';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import toast from 'react-hot-toast';
import { Clock, Globe2, Pencil } from 'lucide-react';
import { PageContainer, PageHeader, Avatar } from '@/components/Avatar';
import { useAuthStore } from '@/stores/auth';
import { usersApi } from '@/api';
import { api, ApiException } from '@/api/client';

const profileSchema = z.object({
  fullName: z.string().min(1).max(200),
});

const passwordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Current password is required'),
    newPassword: z.string().min(8, 'At least 8 characters'),
    confirm: z.string(),
  })
  .refine((d) => d.newPassword === d.confirm, {
    message: 'Passwords must match',
    path: ['confirm'],
  });

/**
 * A friendly list of IANA timezones for the dropdown. We don't try to be
 * exhaustive — instead we list the most common ones and offer "Other" so
 * the user can pick anything the browser knows about.
 *
 * The backend validates any value we send with `Intl.DateTimeFormat`, so
 * we don't need to whitelist here.
 */
const COMMON_TIMEZONES: { value: string; label: string }[] = [
  { value: 'UTC', label: 'UTC' },
  { value: 'Europe/Istanbul', label: 'Europe/Istanbul (UTC+3)' },
  { value: 'Europe/London', label: 'Europe/London' },
  { value: 'Europe/Berlin', label: 'Europe/Berlin' },
  { value: 'Europe/Paris', label: 'Europe/Paris' },
  { value: 'Europe/Madrid', label: 'Europe/Madrid' },
  { value: 'Europe/Warsaw', label: 'Europe/Warsaw' },
  { value: 'Europe/Moscow', label: 'Europe/Moscow' },
  { value: 'Africa/Cairo', label: 'Africa/Cairo' },
  { value: 'Africa/Johannesburg', label: 'Africa/Johannesburg' },
  { value: 'Asia/Dubai', label: 'Asia/Dubai' },
  { value: 'Asia/Karachi', label: 'Asia/Karachi' },
  { value: 'Asia/Kolkata', label: 'Asia/Kolkata' },
  { value: 'Asia/Dhaka', label: 'Asia/Dhaka' },
  { value: 'Asia/Shanghai', label: 'Asia/Shanghai' },
  { value: 'Asia/Tokyo', label: 'Asia/Tokyo' },
  { value: 'Asia/Seoul', label: 'Asia/Seoul' },
  { value: 'Australia/Sydney', label: 'Australia/Sydney' },
  { value: 'Pacific/Auckland', label: 'Pacific/Auckland' },
  { value: 'America/New_York', label: 'America/New_York' },
  { value: 'America/Chicago', label: 'America/Chicago' },
  { value: 'America/Denver', label: 'America/Denver' },
  { value: 'America/Los_Angeles', label: 'America/Los_Angeles' },
  { value: 'America/Toronto', label: 'America/Toronto' },
  { value: 'America/Mexico_City', label: 'America/Mexico_City' },
  { value: 'America/Sao_Paulo', label: 'America/São Paulo' },
  { value: 'America/Argentina/Buenos_Aires', label: 'America/Buenos Aires' },
];

export default function SettingsPage() {
  const user = useAuthStore((s) => s.user)!;
  const setUser = useAuthStore((s) => s.setUser);
  const qc = useQueryClient();
  const [tab, setTab] = useState<'profile' | 'password' | 'timezone'>('profile');

  return (
    <PageContainer>
      <PageHeader title="Settings" subtitle="Manage your profile, password, and timezone" />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <aside className="card p-5 text-center">
          <Avatar name={user.fullName} size="lg" src={user.avatarUrl} className="mx-auto" />
          <div className="mt-3 font-semibold text-slate-800">{user.fullName}</div>
          <div className="text-xs text-slate-500">{user.email}</div>
          <div className="mt-2 capitalize">
            <span className="badge-blue">{user.role}</span>
          </div>
        </aside>
        <div className="md:col-span-2 card overflow-hidden">
          <div className="border-b border-slate-100 flex">
            {(['profile', 'password', 'timezone'] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`px-4 py-2 text-sm font-medium capitalize border-b-2 -mb-px inline-flex items-center gap-1.5 ${
                  tab === t ? 'border-brand-600 text-brand-700' : 'border-transparent text-slate-500'
                }`}
              >
                {t === 'timezone' && <Clock size={14} />}
                {t}
              </button>
            ))}
          </div>
          <div className="p-6">
            {tab === 'profile' && (
              <ProfileForm
                initial={{ fullName: user.fullName }}
                onSubmit={async (d) => {
                  try {
                    const updated = await usersApi.update(user.id, { fullName: d.fullName });
                    setUser({ ...user, fullName: updated.fullName });
                    qc.invalidateQueries({ queryKey: ['users-list'] });
                    toast.success('Saved');
                  } catch (e: any) {
                    toast.error(e?.message ?? 'Failed');
                  }
                }}
              />
            )}
            {tab === 'password' && (
              <PasswordForm
                onSubmit={async (d) => {
                  try {
                    await api.post('/api/v1/auth/change-password', {
                      json: { currentPassword: d.currentPassword, newPassword: d.newPassword },
                    });
                    toast.success('Password updated');
                  } catch (e: any) {
                    if (e instanceof ApiException) toast.error(e.message);
                    else toast.error('Failed');
                  }
                }}
              />
            )}
            {tab === 'timezone' && (
              <TimezoneForm
                current={user.timezone ?? 'UTC'}
                onSubmit={async (tz) => {
                  try {
                    const updated = await api.patch<{ timezone: string }>('/api/v1/auth/me', {
                      json: { timezone: tz },
                    });
                    setUser({ ...user, timezone: updated.timezone });
                    toast.success('Timezone updated');
                  } catch (e: any) {
                    if (e instanceof ApiException) toast.error(e.message);
                    else toast.error('Failed');
                  }
                }}
              />
            )}
          </div>
        </div>
      </div>
    </PageContainer>
  );
}

function ProfileForm({
  initial,
  onSubmit,
}: {
  initial: { fullName: string };
  onSubmit: (d: { fullName: string }) => Promise<void>;
}) {
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<{ fullName: string }>({
    resolver: zodResolver(profileSchema),
    defaultValues: initial,
  });
  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <div>
        <label className="label">Full name</label>
        <input className="input" {...register('fullName')} />
        {errors.fullName && <p className="text-xs text-red-600">{errors.fullName.message}</p>}
      </div>
      <button className="btn-primary" disabled={isSubmitting}>Save</button>
    </form>
  );
}

function PasswordForm({
  onSubmit,
}: {
  onSubmit: (d: { currentPassword: string; newPassword: string }) => Promise<void>;
}) {
  const { register, handleSubmit, formState: { errors, isSubmitting }, reset } = useForm<{
    currentPassword: string; newPassword: string; confirm: string;
  }>({
    resolver: zodResolver(passwordSchema),
  });
  return (
    <form
      onSubmit={handleSubmit(async (d) => {
        await onSubmit(d);
        reset();
      })}
      className="space-y-4"
    >
      <div>
        <label className="label">Current password</label>
        <input type="password" className="input" autoComplete="current-password" {...register('currentPassword')} />
        {errors.currentPassword && <p className="text-xs text-red-600">{errors.currentPassword.message}</p>}
      </div>
      <div>
        <label className="label">New password</label>
        <input type="password" className="input" autoComplete="new-password" {...register('newPassword')} />
        {errors.newPassword && <p className="text-xs text-red-600">{errors.newPassword.message}</p>}
      </div>
      <div>
        <label className="label">Confirm new password</label>
        <input type="password" className="input" autoComplete="new-password" {...register('confirm')} />
        {errors.confirm && <p className="text-xs text-red-600">{errors.confirm.message}</p>}
      </div>
      <button className="btn-primary" disabled={isSubmitting}>Update password</button>
    </form>
  );
}

function TimezoneForm({
  current,
  onSubmit,
}: {
  current: string;
  onSubmit: (tz: string) => Promise<void>;
}) {
  const [tz, setTz] = useState<string>(current);
  const [customTz, setCustomTz] = useState<string>('');
  const [draft, setDraft] = useState<string>(current);
  const [saving, setSaving] = useState(false);

  // Pull the browser-detected TZ (if it differs from the user's stored
  // value) so we can offer a one-click "use my browser's timezone" button.
  const browserTz = useMemo(() => {
    if (typeof window === 'undefined') return null;
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    setDraft(current);
    setTz(current);
  }, [current]);

  const isCommon = useMemo(() => COMMON_TIMEZONES.some((t) => t.value === tz), [tz]);

  const detectedLabel = useMemo(() => {
    if (!browserTz) return null;
    const offset = getBrowserOffsetLabel(browserTz);
    return offset ? `${browserTz} (${offset})` : browserTz;
  }, [browserTz]);

  async function save(value: string) {
    setSaving(true);
    try {
      await onSubmit(value);
      setDraft(value);
      setTz(value);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <label className="label inline-flex items-center gap-1.5">
          <Globe2 size={14} /> Timezone
        </label>
        <select
          className="input"
          value={isCommon ? tz : '__other__'}
          onChange={(e) => {
            const v = e.target.value;
            if (v === '__other__') {
              setTz('__other__');
              setCustomTz(tz === '__other__' ? '' : tz);
            } else {
              setTz(v);
              setCustomTz('');
            }
          }}
        >
          {COMMON_TIMEZONES.map((t) => (
            <option key={t.value} value={t.value}>{t.label}</option>
          ))}
          <option value="__other__">Other…</option>
        </select>
        {tz === '__other__' && (
          <input
            type="text"
            className="input mt-2"
            placeholder="IANA timezone, e.g. Asia/Tokyo"
            value={customTz}
            onChange={(e) => setCustomTz(e.target.value)}
          />
        )}
        <p className="text-xs text-slate-500 mt-1">
          Currently active timezone:{' '}
          <span className="font-mono text-slate-700">{draft}</span>
          {' '}
          ({getBrowserOffsetLabel(draft) ?? 'unknown offset'}).
        </p>
      </div>

      {browserTz && browserTz !== tz && (
        <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 flex items-center gap-3">
          <Globe2 size={16} className="text-slate-500" />
          <div className="flex-1 text-sm">
            <div className="text-slate-700">
              Your browser reports <span className="font-mono">{detectedLabel}</span>.
            </div>
            <div className="text-xs text-slate-500">
              Click below to switch to it.
            </div>
          </div>
          <button
            className="btn-secondary text-xs"
            onClick={() => {
              setTz(browserTz);
              setCustomTz('');
            }}
          >
            Use browser TZ
          </button>
        </div>
      )}

      <div className="flex items-center gap-2">
        <button
          className="btn-primary"
          disabled={saving || (tz === '__other__' && !customTz.trim())}
          onClick={() => {
            const value = tz === '__other__' ? customTz.trim() : tz;
            if (value && value !== draft) save(value);
          }}
        >
          {saving ? 'Saving…' : 'Save timezone'}
        </button>
        {draft && (
          <span className="text-xs text-slate-500 inline-flex items-center gap-1">
            <Pencil size={11} /> Last saved: <span className="font-mono">{draft}</span>
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * Render a "UTC+03:00" style offset label for the given IANA timezone.
 * Uses `Intl.DateTimeFormat` so DST is handled correctly.
 */
function getBrowserOffsetLabel(tz: string): string | null {
  try {
    const dtf = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      timeZoneName: 'shortOffset',
    });
    const parts = dtf.formatToParts(new Date());
    const off = parts.find((p) => p.type === 'timeZoneName')?.value;
    return off ?? null;
  } catch {
    return null;
  }
}
