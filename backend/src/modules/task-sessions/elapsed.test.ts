import { describe, expect, it } from 'vitest';
import { asDate, buildStopDescription, elapsedSeconds, type SessionRow } from './elapsed.js';

/**
 * Wall-clock tests for the server-side elapsed-time math. These guard against
 * the regression that produced the 2x double-counting UI bug: any future change
 * that makes `elapsedSeconds` for a running session return
 * `accumulated + 2 * (now - active_started_at)` (or otherwise inflate it)
 * will fail these tests.
 */

describe('asDate', () => {
  it('returns a Date when given a Date', () => {
    const d = new Date('2026-01-01T00:00:00Z');
    expect(asDate(d)).toBe(d);
  });

  it('parses an ISO string into a Date', () => {
    const d = asDate('2026-01-01T00:00:00Z');
    expect(d).toBeInstanceOf(Date);
    expect(d.toISOString()).toBe('2026-01-01T00:00:00.000Z');
  });
});

describe('elapsedSeconds', () => {
  const now = new Date('2026-07-24T12:00:00.000Z');

  it('returns accumulated_seconds for a paused session (no live delta)', () => {
    const row: SessionRow = {
      status: 'paused',
      accumulated_seconds: 1500,
      active_started_at: null,
    };
    expect(elapsedSeconds(row, now)).toBe(1500);
  });

  it('returns accumulated_seconds for a stopped session (no live delta)', () => {
    const row: SessionRow = {
      status: 'stopped',
      accumulated_seconds: 7200,
      active_started_at: null,
    };
    expect(elapsedSeconds(row, now)).toBe(7200);
  });

  it('returns accumulated + (now - active_started_at) for a running session', () => {
    // 30 seconds of accumulated prior segments + 60 s of the live segment.
    const activeStartedAt = new Date(now.getTime() - 60_000);
    const row: SessionRow = {
      status: 'running',
      accumulated_seconds: 30,
      active_started_at: activeStartedAt,
    };
    expect(elapsedSeconds(row, now)).toBe(90);
  });

  it('returns just (now - active_started_at) when accumulated is 0', () => {
    const activeStartedAt = new Date(now.getTime() - 123_000);
    const row: SessionRow = {
      status: 'running',
      accumulated_seconds: 0,
      active_started_at: activeStartedAt,
    };
    expect(elapsedSeconds(row, now)).toBe(123);
  });

  it('treats missing accumulated_seconds as 0', () => {
    const activeStartedAt = new Date(now.getTime() - 45_000);
    const row: SessionRow = {
      status: 'running',
      active_started_at: activeStartedAt,
    };
    expect(elapsedSeconds(row, now)).toBe(45);
  });

  it('accepts active_started_at as an ISO string (Knex sometimes returns strings)', () => {
    const activeStartedAt = new Date(now.getTime() - 90_000).toISOString();
    const row: SessionRow = {
      status: 'running',
      accumulated_seconds: 10,
      active_started_at: activeStartedAt,
    };
    expect(elapsedSeconds(row, now)).toBe(100);
  });

  it('floors fractional seconds (does NOT round up)', () => {
    // 30.7 s elapsed -> expect 30, not 31.
    const activeStartedAt = new Date(now.getTime() - 30_700);
    const row: SessionRow = {
      status: 'running',
      accumulated_seconds: 0,
      active_started_at: activeStartedAt,
    };
    expect(elapsedSeconds(row, now)).toBe(30);
  });

  it('clamps negative deltas to 0 when active_started_at is in the future', () => {
    // Defensive: a future timestamp must not produce a negative elapsed time.
    const activeStartedAt = new Date(now.getTime() + 60_000);
    const row: SessionRow = {
      status: 'running',
      accumulated_seconds: 100,
      active_started_at: activeStartedAt,
    };
    expect(elapsedSeconds(row, now)).toBe(100);
  });

  it('returns accumulated when running but active_started_at is null', () => {
    const row: SessionRow = {
      status: 'running',
      accumulated_seconds: 42,
      active_started_at: null,
    };
    expect(elapsedSeconds(row, now)).toBe(42);
  });

  it('does NOT double-count (regression guard for the 2x UI bug)', () => {
    // If a future change accidentally returned
    // `accumulated + 2 * (now - active_started_at)`, this test would fail.
    const activeStartedAt = new Date(now.getTime() - 60_000);
    const row: SessionRow = {
      status: 'running',
      accumulated_seconds: 60,
      active_started_at: activeStartedAt,
    };
    const result = elapsedSeconds(row, now);
    expect(result).toBe(120); // accumulated (60) + live delta (60)
    expect(result).not.toBe(180); // would-be 2x value if double-counted
  });

  it('uses the injected `now` parameter for determinism', () => {
    const fixedNow = new Date('2026-07-24T12:00:00.000Z');
    const activeStartedAt = new Date('2026-07-24T11:30:00.000Z'); // 30 min earlier
    const row: SessionRow = {
      status: 'running',
      accumulated_seconds: 0,
      active_started_at: activeStartedAt,
    };
    expect(elapsedSeconds(row, fixedNow)).toBe(30 * 60);
  });

  it('handles large accumulated values without overflow', () => {
    const activeStartedAt = new Date(now.getTime() - 1_000);
    const row: SessionRow = {
      status: 'running',
      accumulated_seconds: 1_000_000, // ~277 hours
      active_started_at: activeStartedAt,
    };
    expect(elapsedSeconds(row, now)).toBe(1_000_001);
  });

  it('coerces a stringified accumulated_seconds to a number', () => {
    const activeStartedAt = new Date(now.getTime() - 10_000);
    const row: SessionRow = {
      status: 'running',
      accumulated_seconds: '15',
      active_started_at: activeStartedAt,
    };
    expect(elapsedSeconds(row, now)).toBe(25);
  });
});

describe('buildStopDescription', () => {
  const taskTitle = 'HVAC rough-in review';

  it('uses the user note when provided', () => {
    expect(buildStopDescription('Coordinated with mechanical subcontractor', taskTitle)).toBe(
      'Coordinated with mechanical subcontractor'
    );
  });

  it('falls back to the default when note is undefined', () => {
    expect(buildStopDescription(undefined, taskTitle)).toBe(`Timer session: ${taskTitle}`);
  });

  it('falls back to the default when note is empty', () => {
    expect(buildStopDescription('', taskTitle)).toBe(`Timer session: ${taskTitle}`);
  });

  it('falls back to the default when note is whitespace-only', () => {
    expect(buildStopDescription('   \t\n  ', taskTitle)).toBe(`Timer session: ${taskTitle}`);
  });

  it('trims surrounding whitespace from the note before storing', () => {
    expect(buildStopDescription('  inspected ductwork  ', taskTitle)).toBe('inspected ductwork');
  });

  it('keeps internal whitespace and newlines intact', () => {
    expect(buildStopDescription('line one\nline two', taskTitle)).toBe('line one\nline two');
  });

  it('interpolates the actual task title into the default', () => {
    expect(buildStopDescription(undefined, 'Pour foundation north quadrant')).toBe(
      'Timer session: Pour foundation north quadrant'
    );
  });

  it('does NOT call Task.title.toUpperCase or transform the note in any way', () => {
    // Guard against future "helpful" transformations that lose user data.
    expect(buildStopDescription('mixed CASE 123 !@#', 'X')).toBe('mixed CASE 123 !@#');
  });
});