import { type ReactNode, useEffect } from 'react';
import { createPortal } from 'react-dom';
import clsx from 'clsx';
import { X } from 'lucide-react';

export function Modal({
  open,
  onClose,
  title,
  size = 'md',
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  size?: 'sm' | 'md' | 'lg';
  children: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  // Lock body scroll while the modal is open so the page underneath doesn't
  // jitter when the overlay appears/disappears. Some pages still need to
  // scroll the modal content (it has its own overflow-y-auto), so we don't
  // touch the modal itself — only the document body.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  if (!open) return null;

  // Render the overlay into <body> instead of wherever this component is
  // mounted. Without the portal, modals nested inside a <td> (e.g. the
  // AddRowButton on the Timesheet grid) get trapped inside the parent
  // stacking context — and if a sibling <td> has the same z-index, it paints
  // on top of the modal. createPortal escapes that entirely so z-50 is
  // compared against the body root, not against the table's z-10 cells.
  return createPortal(
    <div
      className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
    >
      <div
        className={clsx(
          'bg-white rounded-2xl shadow-xl w-full flex flex-col max-h-[90vh] overflow-hidden',
          size === 'sm' && 'max-w-md',
          size === 'md' && 'max-w-xl',
          size === 'lg' && 'max-w-3xl'
        )}
      >
        <header className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <h2 className="text-lg font-semibold text-slate-800">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-700 p-1 rounded"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </header>
        <div className="p-6 overflow-y-auto">{children}</div>
      </div>
    </div>,
    document.body
  );
}
