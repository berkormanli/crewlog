import { format, formatDistanceToNow, parseISO } from 'date-fns';

export const formatDate = (d: string | Date | null | undefined, fmt = 'MMM d, yyyy') => {
  if (!d) return '—';
  const date = typeof d === 'string' ? parseISO(d) : d;
  return format(date, fmt);
};

export const formatDateTime = (d: string | Date | null | undefined) => {
  if (!d) return '—';
  const date = typeof d === 'string' ? parseISO(d) : d;
  return format(date, 'MMM d, yyyy HH:mm');
};

export const fromNow = (d: string | Date | null | undefined) => {
  if (!d) return '—';
  const date = typeof d === 'string' ? parseISO(d) : d;
  return formatDistanceToNow(date, { addSuffix: true });
};

export const initials = (name: string) =>
  name
    .split(' ')
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();

export const todayISODate = () => new Date().toISOString().slice(0, 10);

export const formatBytes = (bytes: number) => {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const v = bytes / Math.pow(1024, i);
  return `${v < 10 && i > 0 ? v.toFixed(1) : Math.round(v)} ${units[i]}`;
};
