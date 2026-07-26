import { useEffect, useRef, useState } from 'react';
import { Modal } from '@/components/Modal';
import { formatSessionDuration } from './useLiveSession';

/**
 * Modal shown when the user clicks Stop on either the in-page TaskTimer or the
 * global header pill. Lets them describe what they did before the session is
 * finalized into a work-log entry.
 *
 * The `liveSecondsAtOpen` is captured at the moment Stop was clicked so the
 * displayed duration is frozen (not ticking) while the modal is open. This
 * matches what the server will record.
 *
 * Props:
 *  - open: controls visibility
 *  - onClose: called when the user cancels or dismisses the modal (timer
 *    keeps running/paused, no API call)
 *  - onConfirm: called with the trimmed note (or '') when the user clicks
 *    "Stop & save" — the parent component actually invokes the API
 *  - taskTitle: pre-fills the textarea placeholder
 *  - busy: disables the submit button while the parent's mutation is pending
 */
export function StopSessionModal({
  open,
  onClose,
  onConfirm,
  taskTitle,
  liveSecondsAtOpen,
  busy,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: (note: string) => void;
  taskTitle: string;
  liveSecondsAtOpen: number;
  busy?: boolean;
}) {
  const [note, setNote] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Reset the note every time the modal re-opens, and auto-focus the textarea
  // so the user can just start typing. We use a layout effect so the focus
  // happens on the same paint as the portal render.
  useEffect(() => {
    if (!open) {
      setNote('');
      return;
    }
    // Defer to next frame to make sure the portal has rendered.
    const id = window.requestAnimationFrame(() => {
      textareaRef.current?.focus();
    });
    return () => window.cancelAnimationFrame(id);
  }, [open]);

  const handleSubmit = (e?: React.FormEvent) => {
    e?.preventDefault();
    onConfirm(note);
  };

  const duration = formatSessionDuration(liveSecondsAtOpen);
  const charCount = note.length;
  const overLimit = charCount > 1000;

  return (
    <Modal open={open} onClose={onClose} title="Stop task timer" size="md">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="rounded-lg bg-slate-50 border border-slate-100 p-4 text-center">
          <div className="font-mono text-3xl font-semibold tracking-tight text-slate-900">
            {duration}
          </div>
          <div className="mt-1 text-xs text-slate-500 truncate" title={taskTitle}>
            {taskTitle}
          </div>
        </div>

        <div>
          <label
            htmlFor="stop-session-note"
            className="block text-sm font-medium text-slate-700"
          >
            What did you work on? <span className="text-slate-400 font-normal">(optional)</span>
          </label>
          <p className="mt-1 text-xs text-slate-500">
            Added to your timesheet so reviewers can see what you did. Leave blank
            to use the default &quot;Timer session: &lt;task title&gt;&quot;.
          </p>
          <textarea
            id="stop-session-note"
            ref={textareaRef}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={4}
            maxLength={1000}
            placeholder={`e.g. Coordinated with mechanical subcontractor on the rough-in plan for ${taskTitle}.`}
            className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none resize-y"
            disabled={busy}
            data-testid="stop-session-note-input"
          />
          <div className={`mt-1 text-xs flex justify-end ${overLimit ? 'text-red-600' : 'text-slate-400'}`}>
            {charCount}/1000
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50"
            disabled={busy}
          >
            Keep running
          </button>
          <button
            type="submit"
            className="px-4 py-2 rounded-lg text-sm font-medium bg-red-600 text-white hover:bg-red-700 disabled:opacity-50 inline-flex items-center gap-1"
            disabled={busy || overLimit}
            data-testid="stop-session-confirm"
          >
            <span className="inline-block w-3 h-3 bg-white" aria-hidden="true" />
            Stop &amp; save
          </button>
        </div>
      </form>
    </Modal>
  );
}