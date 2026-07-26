/**
 * Date helpers.
 *
 * Why: Postgres DATE columns come back from the pg driver as JS Date objects
 * in LOCAL time (e.g. 2026-07-19 00:00:00 +03:00). Naively calling
 * `.toISOString().slice(0, 10)` shifts the day back by the timezone offset.
 * These helpers format dates safely regardless of the server's TZ.
 */

export function isoDate(d: Date | string): string {
  if (typeof d === 'string') {
    // Trust the wire format if it's already ISO
    return d.slice(0, 10);
  }
  // Use local-time components so a DATE column round-trips correctly.
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

export function todayIso(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Returns the ISO date string `n` days before today (local time).
 */
export function daysAgoIso(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}