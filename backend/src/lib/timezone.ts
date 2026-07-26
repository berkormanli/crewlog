/**
 * Best-effort IP→Timezone lookup.
 *
 * Robust strategy:
 *  1. If the request was forwarded by a trusted proxy, use the first
 *     entry of `X-Forwarded-For`.
 *  2. Otherwise fall back to `req.ip`, which honours Fastify's
 *     `trustProxy` config.
 *  3. Hit a free timezone API (ipapi.co) with a short timeout. If the
 *     call fails or returns nothing, return null and let the client-
 *     detected timezone win.
 *
 * The whole thing is best-effort: we never want a TZ lookup to fail a
 * login. Any error is swallowed and returns null.
 */

interface DetectedTimezone {
  timezone: string;
  source: 'ip' | 'header';
}

const HEADERS = ['x-vercel-ip-timezone', 'cf-ipcountry']; // informational
const TIMEZONE_HEADERS = [
  'x-timezone', // a few CDNs / middleware expose this
  'x-vercel-ip-timezone', // Vercel
  'x-cf-timezone', // Cloudflare (rare)
];

const COUNTRY_TZ_FALLBACK: Record<string, string> = {
  // Short map of ISO country → IANA timezone used as a last-resort fallback.
  // Not exhaustive — just covers the regions we commonly see in crews.
  TR: 'Europe/Istanbul',
  US: 'America/New_York',
  CA: 'America/Toronto',
  GB: 'Europe/London',
  DE: 'Europe/Berlin',
  FR: 'Europe/Paris',
  ES: 'Europe/Madrid',
  IT: 'Europe/Rome',
  NL: 'Europe/Amsterdam',
  PL: 'Europe/Warsaw',
  IN: 'Asia/Kolkata',
  PK: 'Asia/Karachi',
  BD: 'Asia/Dhaka',
  CN: 'Asia/Shanghai',
  JP: 'Asia/Tokyo',
  KR: 'Asia/Seoul',
  AU: 'Australia/Sydney',
  NZ: 'Pacific/Auckland',
  BR: 'America/Sao_Paulo',
  MX: 'America/Mexico_City',
  AR: 'America/Argentina/Buenos_Aires',
  ZA: 'Africa/Johannesburg',
  EG: 'Africa/Cairo',
  NG: 'Africa/Lagos',
  AE: 'Asia/Dubai',
  SA: 'Asia/Riyadh',
  RU: 'Europe/Moscow',
  UA: 'Europe/Kiev',
};

interface IncomingLike {
  ip: string;
  headers: Record<string, string | string[] | undefined>;
}

function readHeader(headers: IncomingLike['headers'], name: string): string | undefined {
  const raw = headers[name.toLowerCase()];
  if (Array.isArray(raw)) return raw[0];
  return raw;
}

function getRequestIp(req: IncomingLike): string {
  const xff = readHeader(req.headers, 'x-forwarded-for');
  if (xff) return xff.split(',')[0].trim();
  return req.ip;
}

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<any | null> {
  // Modern Node has fetch + AbortSignal; we isolate the call so it
  // never breaks the login flow.
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const resp = await fetch(url, { signal: ctrl.signal });
    if (!resp.ok) return null;
    return await resp.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Returns a IANA timezone string or null. Resolution order:
 *  1. Look for an explicit header (e.g. `X-Timezone`).
 *  2. Hit ipapi.co/json/<ip>?fields=timezone for the public IP.
 *  3. Drop the country-only fields and try a country→timezone map.
 */
export async function detectTimezoneFromIp(req: IncomingLike): Promise<DetectedTimezone | null> {
  for (const h of TIMEZONE_HEADERS) {
    const v = readHeader(req.headers, h);
    if (v && isValidTimezone(v)) {
      return { timezone: v, source: 'header' };
    }
  }

  const ip = getRequestIp(req);
  // Skip obvious loopback / private IPs — they'll never resolve usefully.
  if (!ip || ip === '127.0.0.1' || ip === '::1' || ip.startsWith('10.') || ip.startsWith('192.168.') || ip.startsWith('169.254.')) {
    return null;
  }

  const data = await fetchWithTimeout(`https://ipapi.co/${encodeURIComponent(ip)}/json/`, 1500);
  if (data && typeof data.timezone === 'string' && isValidTimezone(data.timezone)) {
    return { timezone: data.timezone, source: 'ip' };
  }
  if (data && typeof data.country === 'string' && COUNTRY_TZ_FALLBACK[data.country]) {
    return { timezone: COUNTRY_TZ_FALLBACK[data.country], source: 'ip' };
  }
  void HEADERS;
  return null;
}

/**
 * Best-effort validation of an IANA timezone string. We don't accept
 * arbitrary text — only what `Intl.DateTimeFormat` recognizes.
 *
 * `Intl.DateTimeFormat(undefined, { timeZone })` throws RangeError if
 * the value isn't a real IANA id.
 */
export function isValidTimezone(tz: string): boolean {
  if (!tz || typeof tz !== 'string') return false;
  if (tz.length > 100) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}
