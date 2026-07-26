import { type ReactNode } from 'react';
import clsx from 'clsx';
import { initials } from '@/lib/format';

interface AvatarProps {
  name: string;
  src?: string | null;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const SIZE: Record<NonNullable<AvatarProps['size']>, string> = {
  sm: 'w-7 h-7 text-xs',
  md: 'w-9 h-9 text-sm',
  lg: 'w-12 h-12 text-base',
};

export function Avatar({ name, src, size = 'md', className }: AvatarProps) {
  return (
    <div
      className={clsx(
        'inline-flex items-center justify-center rounded-full bg-brand-100 text-brand-700 font-semibold overflow-hidden flex-shrink-0',
        SIZE[size],
        className
      )}
      aria-hidden
    >
      {src ? (
        <img src={src} alt={name} className="w-full h-full object-cover" />
      ) : (
        <span>{initials(name)}</span>
      )}
    </div>
  );
}

export function AvatarStack({ names, max = 3 }: { names: string[]; max?: number }) {
  const shown = names.slice(0, max);
  const overflow = names.length - shown.length;
  return (
    <div className="flex -space-x-2">
      {shown.map((n, i) => (
        <div key={i} className="ring-2 ring-white rounded-full">
          <Avatar name={n} size="sm" />
        </div>
      ))}
      {overflow > 0 && (
        <div className="ring-2 ring-white rounded-full bg-slate-200 text-slate-700 inline-flex items-center justify-center text-xs font-semibold w-7 h-7">
          +{overflow}
        </div>
      )}
    </div>
  );
}

interface Props {
  children: ReactNode;
  className?: string;
}

export function PageContainer({ children, className }: Props) {
  return <div className={clsx('p-6 lg:p-8 max-w-7xl mx-auto', className)}>{children}</div>;
}

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-3 mb-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </header>
  );
}
