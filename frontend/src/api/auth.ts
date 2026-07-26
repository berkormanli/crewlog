import { api } from './client';
import type { AuthUser, LoginResponse } from '@/types';
import { useAuthStore } from '@/stores/auth';

/**
 * Best-effort detection of the user's IANA timezone. Falls back to UTC
 * whenever the browser doesn't expose the API (e.g. very old browsers,
 * some embedded webviews).
 *
 * We send this on login so the server can persist it on the user's row
 * the first time around. After that the user controls it via /settings.
 */
export function detectBrowserTimezone(): string {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (tz) return tz;
  } catch {
    /* ignore */
  }
  return 'UTC';
}

export async function login(email: string, password: string): Promise<LoginResponse> {
  const timezone = detectBrowserTimezone();
  const data = await api.post<LoginResponse & { settings?: { backdateWindowDays?: number } }>(
    '/api/v1/auth/login',
    {
      json: { email, password, timezone },
      silent: true,
    }
  );
  useAuthStore
    .getState()
    .setSession(data.user, data.access, data.refresh, {
      backdateWindowDays: data.settings?.backdateWindowDays ?? 2,
    });
  return data;
}

/**
 * /auth/me returns `{ id, ..., backdateWindowDays, timezone }`. The
 * window is a server-side constant per deployment, but reading it once
 * on bootstrap lets every page gate UI without round-tripping.
 */
interface AuthMeResponse extends AuthUser {
  backdateWindowDays?: number;
}

export async function refreshMe(): Promise<AuthUser> {
  const me = await api.get<AuthMeResponse>('/api/v1/auth/me');
  useAuthStore.getState().setUser(me);
  if (typeof me.backdateWindowDays === 'number') {
    useAuthStore.getState().setSettings({ backdateWindowDays: me.backdateWindowDays });
  }
  return me;
}

export async function logout() {
  const refresh = useAuthStore.getState().refresh;
  try {
    await api.post('/api/v1/auth/logout', { json: { refreshToken: refresh }, silent: true });
  } catch {
    /* ignore */
  }
  useAuthStore.getState().clear();
}
