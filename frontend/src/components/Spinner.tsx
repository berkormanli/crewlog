import clsx from 'clsx';
import { Loader2 } from 'lucide-react';

export function Spinner({ className, size = 18 }: { className?: string; size?: number }) {
  return <Loader2 className={clsx('animate-spin', className)} size={size} />;
}

export function FullscreenSpinner() {
  return (
    <div className="h-full w-full grid place-items-center">
      <Spinner size={28} className="text-brand-500" />
    </div>
  );
}
