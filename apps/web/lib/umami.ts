// Server-only Umami v2 API client. Self-hosted Umami doesn't expose static
// API keys in the open-source UI, so we authenticate with the admin
// username/password against /api/auth/login and cache the returned Bearer
// token in memory. Credentials must never leak to the browser — only call
// these helpers from Server Components / Route Handlers.

import 'server-only';

const API_URL = (process.env.UMAMI_API_URL ?? '').replace(/\/+$/, '');
const USERNAME = process.env.UMAMI_USERNAME ?? '';
const PASSWORD = process.env.UMAMI_PASSWORD ?? '';
const WEBSITE_ID = process.env.NEXT_PUBLIC_UMAMI_WEBSITE_ID ?? '';

// Umami tokens are valid for ~24h. Refresh slightly earlier to avoid
// races, and force-refresh on any 401 below.
const TOKEN_TTL_MS = 23 * 60 * 60 * 1000;

let tokenCache: { value: string; expiresAt: number } | null = null;
let inFlightLogin: Promise<string> | null = null;

export function isUmamiConfigured(): boolean {
  return Boolean(API_URL && USERNAME && PASSWORD && WEBSITE_ID);
}

export interface UmamiStatField {
  value: number;
  prev: number;
}

export interface UmamiStats {
  pageviews: UmamiStatField;
  visitors: UmamiStatField;
  visits: UmamiStatField;
  bounces: UmamiStatField;
  totaltime: UmamiStatField;
}

export interface UmamiMetric {
  x: string;
  y: number;
}

export type UmamiMetricType = 'url' | 'referrer' | 'country';

export type UmamiUnit = 'minute' | 'hour' | 'day' | 'month' | 'year';

export interface UmamiBuckets {
  pageviews: UmamiMetric[];
  sessions: UmamiMetric[];
}

export interface UmamiActive {
  visitors: number;
}

// Umami v3 renamed the "url" event column to "path"; "referrer" and
// "country" kept their names. Stats responses also flattened — flat
// counts plus a `comparison` sub-object instead of per-field {value, prev}.
const METRIC_TYPE_MAP: Record<UmamiMetricType, string> = {
  url: 'path',
  referrer: 'referrer',
  country: 'country',
};

interface UmamiV3StatsRaw {
  pageviews: number;
  visitors: number;
  visits: number;
  bounces: number;
  totaltime: number;
  comparison?: {
    pageviews?: number;
    visitors?: number;
    visits?: number;
    bounces?: number;
    totaltime?: number;
  };
}

async function login(): Promise<string> {
  const res = await fetch(`${API_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: USERNAME, password: PASSWORD }),
    cache: 'no-store',
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Umami login ${res.status}: ${body.slice(0, 200)}`);
  }
  const data = (await res.json()) as { token?: string };
  if (!data.token) {
    throw new Error('Umami login returned no token.');
  }
  return data.token;
}

async function getToken(forceRefresh = false): Promise<string> {
  if (!forceRefresh && tokenCache && tokenCache.expiresAt > Date.now()) {
    return tokenCache.value;
  }
  if (forceRefresh) {
    tokenCache = null;
  }
  if (!inFlightLogin) {
    inFlightLogin = login()
      .then(token => {
        tokenCache = { value: token, expiresAt: Date.now() + TOKEN_TTL_MS };
        return token;
      })
      .finally(() => {
        inFlightLogin = null;
      });
  }
  return inFlightLogin;
}

async function umamiFetch<T>(path: string): Promise<T> {
  if (!isUmamiConfigured()) {
    throw new Error('Umami not configured (missing API URL, credentials, or website ID).');
  }
  let token = await getToken();
  let res = await fetch(`${API_URL}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  });
  if (res.status === 401) {
    token = await getToken(true);
    res = await fetch(`${API_URL}${path}`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    });
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Umami ${res.status} ${path}: ${body.slice(0, 200)}`);
  }
  return res.json() as Promise<T>;
}

export async function fetchStats(startAt: number, endAt: number): Promise<UmamiStats> {
  const raw = await umamiFetch<UmamiV3StatsRaw>(
    `/api/websites/${WEBSITE_ID}/stats?startAt=${startAt}&endAt=${endAt}`,
  );
  const fields = ['pageviews', 'visitors', 'visits', 'bounces', 'totaltime'] as const;
  const out = {} as UmamiStats;
  for (const k of fields) {
    out[k] = { value: raw[k] ?? 0, prev: raw.comparison?.[k] ?? 0 };
  }
  return out;
}

export function fetchTopMetric(
  type: UmamiMetricType,
  startAt: number,
  endAt: number,
  limit = 10,
): Promise<UmamiMetric[]> {
  const v3Type = METRIC_TYPE_MAP[type];
  return umamiFetch<UmamiMetric[]>(
    `/api/websites/${WEBSITE_ID}/metrics?startAt=${startAt}&endAt=${endAt}&type=${v3Type}&limit=${limit}`,
  );
}

export function fetchPageviewBuckets(
  startAt: number,
  endAt: number,
  unit: UmamiUnit,
  timezone = 'UTC',
): Promise<UmamiBuckets> {
  const tz = encodeURIComponent(timezone);
  return umamiFetch<UmamiBuckets>(
    `/api/websites/${WEBSITE_ID}/pageviews?startAt=${startAt}&endAt=${endAt}&unit=${unit}&timezone=${tz}`,
  );
}

export function fetchActiveUsers(): Promise<UmamiActive> {
  return umamiFetch<UmamiActive>(`/api/websites/${WEBSITE_ID}/active`);
}
