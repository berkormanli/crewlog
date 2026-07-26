import type { Role } from '@/types';

export const canManage = (role: Role) => role === 'manager' || role === 'admin';
export const canAdmin = (role: Role) => role === 'admin';
