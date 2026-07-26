import { type ReactNode } from 'react';
import clsx from 'clsx';

export function EmptyState({
  title,
  description,
  icon,
  action,
  className,
}: {
  title: string;
  description?: ReactNode;
  icon?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={clsx(
        'card flex flex-col items-center justify-center p-10 text-center',
        className
      )}
    >
      {icon && <div className="text-brand-500 mb-3">{icon}</div>}
      <h3 className="text-base font-semibold text-slate-800">{title}</h3>
      {description && <p className="text-sm text-slate-500 mt-1 max-w-md">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorState({ message }: { message: string }) {
  return (
    <div className="card p-6 text-center text-sm text-red-600 bg-red-50 border-red-100">
      <strong>Something went wrong.</strong>
      <p className="mt-1">{message}</p>
    </div>
  );
}
