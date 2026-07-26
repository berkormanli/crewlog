import toast from 'react-hot-toast';
import { useAuthStore } from '@/stores/auth';

// BASE is the origin the SPA calls the API at. The path prefix is already
// part of every call site (e.g. `/api/v1/auth/login`), so strip accidental
// trailing API prefixes from VITE_API_URL before building request URLs.
export function normalizeApiBase(raw: string | undefined): string {
  const base = (raw ?? '').trim().replace(/\/+$/, '');
  if (!base) return '';
  if (base === '/api' || base === '/api/v1') return '';
  return base.replace(/\/api(?:\/v1)?$/, '');
}

const BASE = normalizeApiBase(import.meta.env.VITE_API_URL);

export function apiUrl(path: string): string {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${BASE}${normalizedPath}`;
}

export class ApiException extends Error {
  status: number;
  code: string;
  details?: unknown;
  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

type RequestInitWithBody = RequestInit & { body?: any; json?: any; formData?: FormData; silent?: boolean };

let isRefreshing: Promise<string | null> | null = null;

async function doRefresh(): Promise<string | null> {
  if (!isRefreshing) {
    isRefreshing = (async () => {
      const refresh = useAuthStore.getState().refresh;
      if (!refresh) return null;
      try {
        const resp = await fetch(apiUrl('/api/v1/auth/refresh'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken: refresh }),
        });
        if (!resp.ok) return null;
        const data = (await resp.json()) as { access: string; refresh: string };
        useAuthStore.getState().setTokens(data.access, data.refresh);
        return data.access;
      } catch {
        return null;
      } finally {
        // Allow next refresh after a tick
        setTimeout(() => {
          isRefreshing = null;
        }, 0);
      }
    })();
  }
  return isRefreshing;
}

async function request<T>(method: string, path: string, init: RequestInitWithBody = {}): Promise<T> {
  const { json, formData, body, silent, headers, ...rest } = init;
  const finalBody = formData ?? (json !== undefined ? JSON.stringify(json) : body);
  // IMPORTANT: read tokens once at the start, but on 401 retry re-read them so
  // we pick up the freshly-rotated access token. Otherwise we replay the same
  // 401 forever until the user reloads.
  const initialRefresh = useAuthStore.getState().refresh;

  const finalHeaders: Record<string, string> = {
    ...(headers as Record<string, string> | undefined),
  };
  if (formData) {
    // let browser set content-type
  } else if (json !== undefined) {
    finalHeaders['Content-Type'] = 'application/json';
  }

  let resp: Response;
  let triedRefresh = false;
  while (true) {
    // Re-read on every iteration — after a successful refresh the store has the
    // new access token we should use.
    const currentAccess = useAuthStore.getState().access;
    finalHeaders['Authorization'] = `Bearer ${currentAccess ?? ''}`;
    resp = await fetch(apiUrl(path), {
      method,
      ...rest,
      headers: finalHeaders,
      body: finalBody,
    });
    if (resp.status !== 401 || triedRefresh || !currentAccess) break;
    if (!initialRefresh) break; // no refresh token — nothing we can do
    triedRefresh = true;
    const newAccess = await doRefresh();
    if (!newAccess) {
      // Refresh failed — force logout
      useAuthStore.getState().clear();
      if (!silent) toast.error('Session expired. Please log in again.');
      throw new ApiException(401, 'unauthorized', 'Session expired.');
    }
  }

  if (!resp.ok) {
    let payload: any = null;
    try {
      payload = await resp.json();
    } catch {
      // ignore
    }
    const err = payload?.error ?? {};
    const msg = err.message ?? resp.statusText ?? 'Request failed';
    if (!silent && resp.status !== 401) {
      if (resp.status !== 403) toast.error(msg); // 403 is "expected" when policy blocks; UI can show inline
    }
    throw new ApiException(resp.status, err.code ?? 'unknown', msg, err.details);
  }

  // 204 or empty
  const text = await resp.text();
  if (!text) return undefined as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    return text as T;
  }
}

export const api = {
  get: <T>(path: string, init?: RequestInitWithBody) => request<T>('GET', path, init),
  post: <T>(path: string, init?: RequestInitWithBody) => request<T>('POST', path, init),
  patch: <T>(path: string, init?: RequestInitWithBody) => request<T>('PATCH', path, init),
  put: <T>(path: string, init?: RequestInitWithBody) => request<T>('PUT', path, init),
  delete: <T>(path: string, init?: RequestInitWithBody) => request<T>('DELETE', path, init),
};

export const apiBase = BASE;
