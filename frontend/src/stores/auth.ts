import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { AuthUser } from '@/types';

interface AppSettings {
  /** Mirror of `BACKDATE_WINDOW_DAYS` from the backend — used for client-side
   *  edit-window gating so we don't show action buttons we know will 403. */
  backdateWindowDays: number;
}

interface AuthState {
  user: AuthUser | null;
  access: string | null;
  refresh: string | null;
  settings: AppSettings;
  setSession: (user: AuthUser, access: string, refresh: string, settings?: AppSettings) => void;
  setTokens: (access: string, refresh: string) => void;
  setUser: (user: AuthUser | null) => void;
  setSettings: (settings: Partial<AppSettings>) => void;
  clear: () => void;
}

const DEFAULT_SETTINGS: AppSettings = { backdateWindowDays: 2 };

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      access: null,
      refresh: null,
      settings: DEFAULT_SETTINGS,
      setSession: (user, access, refresh, settings) =>
        set({ user, access, refresh, settings: { ...DEFAULT_SETTINGS, ...(settings ?? {}) } }),
      setTokens: (access, refresh) => set({ access, refresh }),
      setUser: (user) => set({ user }),
      setSettings: (settings) =>
        set((s) => ({ settings: { ...s.settings, ...settings } })),
      clear: () =>
        set({ user: null, access: null, refresh: null, settings: DEFAULT_SETTINGS }),
    }),
    {
      name: 'crewlog.auth',
      partialize: (s) => ({ user: s.user, access: s.access, refresh: s.refresh, settings: s.settings }),
    }
  )
);
