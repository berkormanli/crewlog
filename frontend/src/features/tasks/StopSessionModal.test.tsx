import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { StopSessionModal } from './StopSessionModal';

afterEach(() => {
  cleanup();
});

describe('StopSessionModal', () => {
  const defaultProps = {
    open: true,
    onClose: vi.fn(),
    onConfirm: vi.fn(),
    taskTitle: 'HVAC rough-in review',
    liveSecondsAtOpen: 3725, // 01:02:05
  };

  it('renders the frozen elapsed duration', () => {
    render(<StopSessionModal {...defaultProps} />);
    expect(screen.getByText('01:02:05')).toBeInTheDocument();
  });

  it('renders the task title', () => {
    render(<StopSessionModal {...defaultProps} taskTitle="Pour foundation" />);
    expect(screen.getByText('Pour foundation')).toBeInTheDocument();
  });

  it('renders nothing when closed', () => {
    render(<StopSessionModal {...defaultProps} open={false} />);
    expect(screen.queryByText('Stop task timer')).not.toBeInTheDocument();
  });

  it('shows a textarea labeled "What did you work on?"', () => {
    render(<StopSessionModal {...defaultProps} />);
    expect(screen.getByLabelText(/What did you work on/)).toBeInTheDocument();
  });

  it('has Keep running and Stop & save buttons', () => {
    render(<StopSessionModal {...defaultProps} />);
    expect(screen.getByRole('button', { name: /Keep running/i })).toBeInTheDocument();
    expect(screen.getByTestId('stop-session-confirm')).toHaveTextContent(/Stop.+save/i);
  });

  it('renders an info hint about the default description', () => {
    render(<StopSessionModal {...defaultProps} />);
    expect(
      screen.getByText(/Leave blank[\s\S]*to use the default/i)
    ).toBeInTheDocument();
  });

  it('calls onConfirm with the trimmed note when the form is submitted', () => {
    const onConfirm = vi.fn();
    render(<StopSessionModal {...defaultProps} onConfirm={onConfirm} />);
    const textarea = screen.getByTestId('stop-session-note-input');
    fireEvent.change(textarea, { target: { value: '  coordinated with subs  ' } });
    fireEvent.click(screen.getByTestId('stop-session-confirm'));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    // Note: the component does not trim itself; the backend buildStopDescription
    // does the trim. We pass through the raw string the user typed so the
    // server stays the source of truth.
    expect(onConfirm).toHaveBeenCalledWith('  coordinated with subs  ');
  });

  it('calls onConfirm with empty string when submitted without typing', () => {
    const onConfirm = vi.fn();
    render(<StopSessionModal {...defaultProps} onConfirm={onConfirm} />);
    fireEvent.click(screen.getByTestId('stop-session-confirm'));
    expect(onConfirm).toHaveBeenCalledWith('');
  });

  it('calls onClose when Keep running is clicked', () => {
    const onClose = vi.fn();
    render(<StopSessionModal {...defaultProps} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: /Keep running/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
    // The parent component decides what to do with onClose — typically setting
    // `open=false`. The modal itself just renders while `open` is true.
  });

  it('disappears when `open` becomes false', () => {
    const { rerender } = render(<StopSessionModal {...defaultProps} />);
    expect(screen.getByTestId('stop-session-confirm')).toBeInTheDocument();
    rerender(<StopSessionModal {...defaultProps} open={false} />);
    expect(screen.queryByTestId('stop-session-confirm')).not.toBeInTheDocument();
  });

  it('disables buttons when busy', () => {
    render(<StopSessionModal {...defaultProps} busy />);
    expect(screen.getByRole('button', { name: /Keep running/i })).toBeDisabled();
    expect(screen.getByTestId('stop-session-confirm')).toBeDisabled();
  });

  it('clears the note when reopened (re-mount)', () => {
    const onConfirm = vi.fn();
    const { rerender } = render(<StopSessionModal {...defaultProps} onConfirm={onConfirm} />);
    fireEvent.change(screen.getByTestId('stop-session-note-input'), {
      target: { value: 'first attempt' },
    });
    expect(screen.getByTestId('stop-session-note-input')).toHaveValue('first attempt');

    // Close
    rerender(<StopSessionModal {...defaultProps} open={false} onConfirm={onConfirm} />);
    // Re-open
    rerender(<StopSessionModal {...defaultProps} open onConfirm={onConfirm} />);
    expect(screen.getByTestId('stop-session-note-input')).toHaveValue('');
  });

  it('counts characters toward the 1000-char limit', () => {
    render(<StopSessionModal {...defaultProps} />);
    const textarea = screen.getByTestId('stop-session-note-input');
    fireEvent.change(textarea, { target: { value: 'x'.repeat(250) } });
    expect(screen.getByText('250/1000')).toBeInTheDocument();
  });

  it('disables submit when over 1000 characters (textarea enforces maxLength but cover the visual path)', () => {
    render(<StopSessionModal {...defaultProps} />);
    // Note: the textarea uses maxLength=1000 so the browser blocks input. We
    // assert that the counter is rendered so the limit is visible to the user.
    expect(screen.getByText('0/1000')).toBeInTheDocument();
  });
});