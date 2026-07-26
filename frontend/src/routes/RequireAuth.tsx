import { Navigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '@/stores/auth';

export function RequireAuth({ children }: { children: React.ReactNode }) {
  const user = useAuthStore((s) => s.user);
  const access = useAuthStore((s) => s.access);
  const location = useLocation();

  if (!user || !access) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  return <>{children}</>;
}

export function RequireRole({
  roles,
  children,
}: {
  roles: ('worker' | 'manager' | 'admin')[];
  children: React.ReactNode;
}) {
  const user = useAuthStore((s) => s.user);
  const access = useAuthStore((s) => s.access);

  if (!user || !access) return <Navigate to="/login" replace />;
  if (!roles.includes(user.role)) return <Navigate to="/" replace />;
  return <>{children}</>;
}
