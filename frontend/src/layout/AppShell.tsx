import { useEffect, useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import {
  Building2,
  CalendarDays,
  ClipboardList,
  Cog,
  Files,
  FolderKanban,
  History,
  Inbox,
  LayoutDashboard,
  LogOut,
  Settings,
  ShieldCheck,
  Users,
  type LucideIcon,
  Clock,
} from 'lucide-react';
import clsx from 'clsx';
import { Avatar } from '@/components/Avatar';
import { useAuthStore } from '@/stores/auth';
import { logout } from '@/api/auth';
import { canAdmin } from '@/lib/rbac';
import GlobalTimerPill from '@/features/tasks/GlobalTimerPill';

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  roles?: ('worker' | 'manager' | 'admin')[];
}

const NAV: NavItem[] = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/logs/timesheet', label: 'Timesheet', icon: Clock },
  { to: '/tasks', label: 'My Tasks', icon: ClipboardList, roles: ['worker'] },
  { to: '/tasks/list', label: 'All Tasks', icon: ClipboardList, roles: ['manager', 'admin'] },
  { to: '/tasks/requests', label: 'Requests', icon: Inbox, roles: ['manager', 'admin'] },
  { to: '/projects', label: 'Projects', icon: FolderKanban },
  { to: '/customers', label: 'Customers', icon: Building2 },
  { to: '/documents', label: 'Documents', icon: Files },
  { to: '/logs', label: 'My Logs', icon: CalendarDays },
  { to: '/team/logs', label: 'Team Logs', icon: ShieldCheck, roles: ['manager', 'admin'] },
  { to: '/admin/lookups', label: 'Lookups', icon: Cog, roles: ['manager', 'admin'] },
  { to: '/admin/activity', label: 'Activity', icon: History, roles: ['manager', 'admin'] },
  { to: '/admin/users', label: 'Users', icon: Users, roles: ['admin'] },
];

const SIDEBAR_COLLAPSED_KEY = 'crewlog.sidebar.collapsed';

export default function AppShell() {
  const user = useAuthStore((s) => s.user);
  const navigate = useNavigate();

  // Start expanded; read persisted preference after mount to avoid SSR flash.
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    try {
      const stored = localStorage.getItem(SIDEBAR_COLLAPSED_KEY);
      if (stored === '1') setCollapsed(true);
    } catch {
      /* ignore */
    }
  }, []);

  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(SIDEBAR_COLLAPSED_KEY, next ? '1' : '0');
      } catch {
        /* ignore */
      }
      return next;
    });
  };

  if (!user) return null;
  const role = user.role;
  const items = NAV.filter((n) => !n.roles || n.roles.includes(role));

  const sidebarWidth = collapsed ? 'w-16' : 'w-64';

  return (
    <div className="min-h-screen flex bg-canvas">
      <a href="#main-content" className="skip-link">
        Skip to main content
      </a>

      <aside
        className={clsx(
          sidebarWidth,
          'bg-surface border-r border-border flex flex-col flex-shrink-0 transition-[width] duration-200 ease-out'
        )}
        aria-label="Primary navigation"
      >
        <button
          type="button"
          onClick={toggleCollapsed}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-pressed={collapsed}
          className={clsx(
            'h-16 border-b border-border flex items-center gap-2 flex-shrink-0 group hover:bg-surface-2 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500',
            collapsed ? 'justify-center px-2' : 'px-5'
          )}
        >
          <span className="w-9 h-9 rounded-lg bg-brand-600 grid place-items-center text-white font-bold flex-shrink-0 group-hover:scale-105 transition-transform">
            C
          </span>
          {!collapsed && (
            <span className="min-w-0 text-left">
              <span className="block text-base font-bold text-fg leading-none">CrewLog</span>
              <span className="block text-xs text-subtle mt-1">Workforce tracker</span>
            </span>
          )}
        </button>

        <nav className="flex-1 px-2 py-3 space-y-1 overflow-y-auto" aria-label="Main">
          {items.map((it) => (
            <NavLink
              key={it.to}
              to={it.to}
              // Only `/` uses prefix matching so it lights up as the implicit
              // home; every other link is an exact-path match. This prevents
              // e.g. both "Timesheet" (`/logs/timesheet`) and "My Logs"
              // (`/logs`) lighting up at the same time.
              end={it.to !== '/'}
              title={collapsed ? it.label : undefined}
              className={clsx(
                'sidebar-link flex items-center gap-3 rounded-lg text-sm text-muted hover:bg-surface-2 hover:text-fg transition',
                collapsed ? 'justify-center px-2 py-2' : 'px-3 py-2'
              )}
            >
              <it.icon size={18} className="flex-shrink-0" aria-hidden="true" />
              {!collapsed && <span className="truncate">{it.label}</span>}
            </NavLink>
          ))}
        </nav>

        <div className="border-t border-border p-2 flex-shrink-0 space-y-1">
          {!collapsed && (
            <NavLink
              to="/settings"
              className={({ isActive }) =>
                clsx(
                  'flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-muted hover:bg-surface-2 hover:text-fg',
                  isActive && 'bg-surface-2 text-fg'
                )
              }
            >
              <Settings size={18} className="flex-shrink-0" aria-hidden="true" />
              <span>Settings</span>
            </NavLink>
          )}

          {!collapsed ? (
            <div className="flex items-center gap-3 px-3 py-3 rounded-lg">
              <Avatar name={user.fullName} src={user.avatarUrl} size="md" />
              <div className="min-w-0">
                <div className="text-sm font-medium text-fg truncate">{user.fullName}</div>
                <div className="text-xs text-subtle capitalize">
                  {user.role}
                  {canAdmin(role) && ' · Admin'}
                </div>
              </div>
            </div>
          ) : (
            <div className="flex justify-center py-2">
              <Avatar name={user.fullName} src={user.avatarUrl} size="md" />
            </div>
          )}

          <button
            onClick={async () => {
              await logout();
              navigate('/login', { replace: true });
            }}
            className={clsx(
              'w-full inline-flex items-center text-muted hover:bg-danger-bg hover:text-danger-fg rounded-md',
              collapsed ? 'justify-center p-2' : 'gap-2 px-3 py-2 text-sm'
            )}
            aria-label={collapsed ? 'Sign out' : undefined}
            title="Sign out"
          >
            <LogOut size={18} aria-hidden="true" />
            {!collapsed && <span>Sign out</span>}
          </button>
        </div>
      </aside>

      <main id="main-content" className="flex-1 min-w-0 overflow-y-auto" tabIndex={-1}>
        <GlobalTimerPill />
        <Outlet />
      </main>
    </div>
  );
}