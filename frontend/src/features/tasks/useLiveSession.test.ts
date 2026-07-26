import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { formatSessionDuration, useLiveSeconds } from './useLiveSession';
import type { TaskWorkSession } from '@/types';

/**
 * Locks in the corrected live-tick math used by both TaskTimer and
 * GlobalTimerPill. The original bug was that the client added
 * `(now - activeStartedAt)` on top of the server's already-ticked
 * `elapsedSeconds`, producing ~2x real-time display. These tests will fail
 * loudly if anyone reverts the fix or copies the wrong formula into a new
 * surface.
 */

function makeSession(overrides: Partial<TaskWorkSession> = {}): TaskWorkSession {
  return {
    id: 'sess-1',
    tenantId: 'tenant-1',
    taskId: 'task-1',
    workerId: 'worker-1',
    status: 'running',
    startedAt: '2026-07-24T10:00:00.000Z',
    activeStartedAt: '2026-07-24T10:00:00.000Z',
    pausedAt: null,
    endedAt: null,
    elapsedSeconds: 0,
    accumulatedSeconds: 0,
    durationSeconds: null,
    workLogId: null,
    createdAt: '2026-07-24T10:00:00.000Z',
    updatedAt: '2026-07-24T10:00:00.000Z',
    ...overrides,
  };
}

describe('formatSessionDuration', () => {
  it('formats 0 seconds', () => {
    expect(formatSessionDuration(0)).toBe('00:00:00');
  });

  it('formats seconds under a minute', () => {
    expect(formatSessionDuration(7)).toBe('00:00:07');
  });

  it('zero-pads single-digit hours, minutes, seconds', () => {
    expect(formatSessionDuration(3661)).toBe('01:01:01');
  });

  it('formats 99 hours correctly', () => {
    expect(formatSessionDuration(99 * 3600 + 59 * 60 + 59)).toBe('99:59:59');
  });

  it('floors fractional seconds (does NOT round)', () => {
    expect(formatSessionDuration(59.9)).toBe('00:00:59');
  });

  it('clamps negative inputs to 0', () => {
    expect(formatSessionDuration(-10)).toBe('00:00:00');
  });
});

describe('useLiveSeconds', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-24T12:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns 0 when session is null', () => {
    const { result } = renderHook(() => useLiveSeconds(null));
    expect(result.current).toBe(0);
  });

  it('returns accumulatedSeconds immediately for a paused session', () => {
    const session = makeSession({ status: 'paused', accumulatedSeconds: 1234, activeStartedAt: null });
    const { result } = renderHook(() => useLiveSeconds(session));
    expect(result.current).toBe(1234);
  });

  it('returns accumulatedSeconds immediately for a stopped session', () => {
    const session = makeSession({ status: 'stopped', accumulatedSeconds: 5678, activeStartedAt: null });
    const { result } = renderHook(() => useLiveSeconds(session));
    expect(result.current).toBe(5678);
  });

  it('returns accumulatedSeconds when running but activeStartedAt is null', () => {
    const session = makeSession({ status: 'running', accumulatedSeconds: 99, activeStartedAt: null });
    const { result } = renderHook(() => useLiveSeconds(session));
    expect(result.current).toBe(99);
  });

  it('returns accumulated + (now - activeStartedAt) for a running session', () => {
    // activeStartedAt = 60 s ago, accumulated = 30 -> expect 90.
    const session = makeSession({
      status: 'running',
      accumulatedSeconds: 30,
      activeStartedAt: '2026-07-24T11:59:00.000Z',
    });
    const { result } = renderHook(() => useLiveSeconds(session));
    expect(result.current).toBe(90);
  });

  it('returns just (now - activeStartedAt) when accumulated is 0', () => {
    const session = makeSession({
      status: 'running',
      accumulatedSeconds: 0,
      activeStartedAt: '2026-07-24T11:57:37.000Z',
    });
    const { result } = renderHook(() => useLiveSeconds(session));
    expect(result.current).toBe(143); // 2 min 23 s
  });

  it('increments by ~1 per second (does NOT double-count — regression guard)', async () => {
    const session = makeSession({
      status: 'running',
      accumulatedSeconds: 0,
      activeStartedAt: '2026-07-24T12:00:00.000Z',
    });
    const { result } = renderHook(() => useLiveSeconds(session));

    expect(result.current).toBe(0);

    // Advance 60 wall-clock seconds; the per-second setInterval should fire.
    await act(async () => {
      vi.advanceTimersByTime(60_000);
    });

    // Must be ~60, NOT ~120. This is the regression guard for the 2x bug.
    expect(result.current).toBe(60);
    expect(result.current).not.toBe(120);
  });

  it('after pause+resume, accumulatedSeconds carries forward correctly', async () => {
    // Simulate: previously ran 60 s, paused, then resumed and is now 10 s in.
    const session = makeSession({
      status: 'running',
      accumulatedSeconds: 60, // committed by server at pause time
      activeStartedAt: '2026-07-24T11:59:50.000Z', // resumed 10 s ago
    });
    const { result } = renderHook(() => useLiveSeconds(session));
    expect(result.current).toBe(70); // 60 accumulated + 10 live

    // After 5 more seconds, total should be 75, not 140.
    await act(async () => {
      vi.advanceTimersByTime(5_000);
    });
    expect(result.current).toBe(75);
    expect(result.current).not.toBe(140);
  });

  it('stops ticking once the session is no longer running', async () => {
    const session = makeSession({
      status: 'running',
      accumulatedSeconds: 0,
      activeStartedAt: '2026-07-24T12:00:00.000Z',
    });
    const { result, rerender } = renderHook(({ s }) => useLiveSeconds(s), { initialProps: { s: session } });
    expect(result.current).toBe(0);

    await act(async () => {
      vi.advanceTimersByTime(5_000);
    });
    expect(result.current).toBe(5);

    // Now pause -> should freeze at accumulatedSeconds (5) and not continue.
    rerender({ s: { ...session, status: 'paused' as const, activeStartedAt: null, accumulatedSeconds: 5 } });
    await act(async () => {
      vi.advanceTimersByTime(10_000);
    });
    expect(result.current).toBe(5);
  });

  it('clamps negative deltas (defensive: future activeStartedAt)', () => {
    const session = makeSession({
      status: 'running',
      accumulatedSeconds: 100,
      activeStartedAt: '2026-07-24T13:00:00.000Z', // 1 hour in the future
    });
    const { result } = renderHook(() => useLiveSeconds(session));
    expect(result.current).toBe(100); // clamped, not negative
  });

  it('cleans up the interval on unmount (no leaked timers)', () => {
    const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval');
    const session = makeSession({
      status: 'running',
      accumulatedSeconds: 0,
      activeStartedAt: '2026-07-24T12:00:00.000Z',
    });
    const { unmount } = renderHook(() => useLiveSeconds(session));
    expect(clearIntervalSpy).not.toHaveBeenCalled();
    unmount();
    expect(clearIntervalSpy).toHaveBeenCalled();
  });
});