// Server-only Umami v2 API client. Reads UMAMI_API_URL / UMAMI_API_TOKEN /
// NEXT_PUBLIC_UMAMI_WEBSITE_ID from env. Token must never leak to the browser
// — only call these helpers from Server Components / Route Handlers.

import 'server-only';

const API_URL = (process.env.UMAMI_API_URL ?? '').replace(/\/+$/, '');
const API_TOKEN = process.env.UMAMI_API_TOKEN ?? '';
const WEBSITE_ID = process.env.NEXT_PUBLIC_UMAMI_WEBSITE_ID ?? '';

export function isUmamiConfigured(): boolean {
  return Boolean(API_URL && API_TOKEN && WEBSITE_ID);
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

async function umamiFetch<T>(path: string): Promise<T> {
  if (!isUmamiConfigured()) {
    throw new Error('Umami not configured (missing API URL, token, or website ID).');
  }
  const res = await fetch(`${API_URL}${path}`, {
    headers: { Authorization: `Bearer ${API_TOKEN}` },
    cache: 'no-store',
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Umami ${res.status} ${path}: ${body.slice(0, 200)}`);
  }
  return res.json() as Promise<T>;
}

export function fetchStats(startAt: number, endAt: number): Promise<UmamiStats> {
  return umamiFetch<UmamiStats>(
    `/api/websites/${WEBSITE_ID}/stats?startAt=${startAt}&endAt=${endAt}`,
  );
}

export function fetchTopMetric(
  type: UmamiMetricType,
  startAt: number,
  endAt: number,
  limit = 10,
): Promise<UmamiMetric[]> {
  return umamiFetch<UmamiMetric[]>(
    `/api/websites/${WEBSITE_ID}/metrics?startAt=${startAt}&endAt=${endAt}&type=${type}&limit=${limit}`,
  );
}
