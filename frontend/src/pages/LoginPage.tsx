import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useNavigate, useLocation, Navigate } from 'react-router-dom';
import { login } from '@/api/auth';
import { useAuthStore } from '@/stores/auth';
import { Spinner } from '@/components/Spinner';
import { ApiException } from '@/api/client';

const schema = z.object({
  email: z.string().min(1, 'Email is required').email(),
  password: z.string().min(1, 'Password is required'),
});

type FormValues = z.infer<typeof schema>;

export default function LoginPage() {
  const user = useAuthStore((s) => s.user);
  const access = useAuthStore((s) => s.access);
  const navigate = useNavigate();
  const location = useLocation();
  const [serverError, setServerError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
    setValue,
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { email: '', password: '' },
  });

  if (user && access) {
    return <Navigate to={(location.state as any)?.from ?? '/'} replace />;
  }

  async function onSubmit(values: FormValues) {
    setServerError(null);
    setSubmitting(true);
    try {
      await login(values.email, values.password);
      navigate('/', { replace: true });
    } catch (err) {
      if (err instanceof ApiException) setServerError(err.message);
      else setServerError('Unable to log in');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen grid place-items-center bg-gradient-to-br from-brand-50 via-white to-slate-100 px-4">
      <div className="w-full max-w-md card p-8">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-xl bg-brand-600 grid place-items-center text-white font-bold text-lg">
            C
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900">CrewLog</h1>
            <p className="text-sm text-slate-500">Sign in to your account</p>
          </div>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
          <div>
            <label htmlFor="email" className="label">Email</label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              className="input"
              {...register('email')}
              aria-invalid={!!errors.email}
            />
            {errors.email && (
              <p className="mt-1 text-xs text-red-600">{errors.email.message}</p>
            )}
          </div>
          <div>
            <label htmlFor="password" className="label">Password</label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              className="input"
              {...register('password')}
              aria-invalid={!!errors.password}
            />
            {errors.password && (
              <p className="mt-1 text-xs text-red-600">{errors.password.message}</p>
            )}
          </div>

          {serverError && (
            <div className="bg-red-50 border border-red-100 text-sm text-red-700 px-3 py-2 rounded-lg">
              {serverError}
            </div>
          )}

          <button type="submit" className="btn-primary w-full" disabled={submitting}>
            {submitting ? <Spinner /> : 'Sign in'}
          </button>
        </form>

        <div className="mt-6 border-t border-slate-100 pt-4 text-xs text-slate-500">
          <p className="font-medium text-slate-600 mb-2">Demo accounts (click to fill):</p>
          <ul className="space-y-1">
            {[
              ['admin@crewlog.local', 'Admin123!'],
              ['manager.alex@crewlog.local', 'Manager123!'],
              ['worker.jordan@crewlog.local', 'Worker123!'],
            ].map(([e, p]) => (
              <li key={e}>
                <button
                  type="button"
                  className="text-left w-full hover:bg-slate-50 px-2 py-1 rounded font-mono"
                  onClick={() => {
                    setValue('email', e);
                    setValue('password', p);
                  }}
                >
                  <span className="text-slate-700">{e}</span>
                  <span className="text-slate-400"> · </span>
                  <span className="text-slate-400">{p}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
