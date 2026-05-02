/**
 * Shared HTTP client utilities for all WPI crawlers.
 * - Polite User-Agent
 * - Exponential backoff (3 retries on 5xx / network error)
 * - 2-second host-gap enforcement
 * - robots.txt check (cached per host)
 */

const USER_AGENT = 'WindPowerIndia-CrawlBot/1.0 (+https://windpowerindia.in; contact: data@wpi.in)';

// Per-host last request timestamp
const hostLastRequest: Record<string, number> = {};
const robotsCache: Record<string, string> = {};

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function respectPoliteDelay(host: string) {
  const last = hostLastRequest[host] ?? 0;
  const elapsed = Date.now() - last;
  const GAP_MS = 2000;
  if (elapsed < GAP_MS) {
    await sleep(GAP_MS - elapsed);
  }
  hostLastRequest[host] = Date.now();
}

async function fetchRobotsTxt(host: string): Promise<string> {
  if (robotsCache[host]) return robotsCache[host];
  try {
    const res = await fetch(`https://${host}/robots.txt`, {
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(5000)
    });
    const text = res.ok ? await res.text() : '';
    robotsCache[host] = text;
    return text;
  } catch {
    return '';
  }
}

function isAllowedByRobots(robotsTxt: string, path: string): boolean {
  if (!robotsTxt) return true;
  const lines = robotsTxt.split('\n');
  let inOurBlock = false;
  for (const line of lines) {
    const trimmed = line.trim().toLowerCase();
    if (trimmed.startsWith('user-agent:')) {
      const agent = line.split(':')[1]?.trim().toLowerCase() ?? '';
      inOurBlock = agent === '*' || agent.includes('windpowerindia');
    } else if (inOurBlock && trimmed.startsWith('disallow:')) {
      const disallowedPath = line.split(':')[1]?.trim() ?? '';
      if (disallowedPath && path.startsWith(disallowedPath)) {
        return false;
      }
    }
  }
  return true;
}

export async function politeFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const parsed = new URL(url);
  const host = parsed.hostname;
  const path = parsed.pathname;

  const robotsTxt = await fetchRobotsTxt(host);
  if (!isAllowedByRobots(robotsTxt, path)) {
    throw new Error(`robots.txt disallows crawling ${url}`);
  }

  await respectPoliteDelay(host);

  const headers = {
    'User-Agent': USER_AGENT,
    'Accept': 'text/html,application/xhtml+xml,application/json,application/rss+xml,*/*',
    ...(options.headers as Record<string, string> ?? {})
  };

  const MAX_RETRIES = 3;
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(url, {
        ...options,
        headers,
        signal: AbortSignal.timeout(15000)
      });
      if (res.status >= 500) {
        lastError = new Error(`HTTP ${res.status}`);
        await sleep(Math.pow(2, attempt) * 1000);
        continue;
      }
      return res;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      await sleep(Math.pow(2, attempt) * 1000);
    }
  }
  throw lastError ?? new Error('Unknown fetch error');
}

/** Parse RSS/Atom feeds, returns array of items */
export function parseRssItems(xml: string): Array<{ title: string; link: string; pubDate: string; description?: string }> {
  const items: Array<{ title: string; link: string; pubDate: string; description?: string }> = [];
  const itemMatches = xml.match(/<item[^>]*>([\s\S]*?)<\/item>/gi) ?? [];
  for (const item of itemMatches) {
    const title = item.match(/<title[^>]*><!\[CDATA\[([\s\S]*?)\]\]><\/title>|<title[^>]*>([\s\S]*?)<\/title>/i);
    const link = item.match(/<link[^>]*>([\s\S]*?)<\/link>|<guid[^>]*>(https?[^<]+)<\/guid>/i);
    const pubDate = item.match(/<pubDate[^>]*>([\s\S]*?)<\/pubDate>/i);
    const desc = item.match(/<description[^>]*><!\[CDATA\[([\s\S]*?)\]\]><\/description>|<description[^>]*>([\s\S]*?)<\/description>/i);
    
    if (title && link) {
      items.push({
        title: (title[1] ?? title[2] ?? '').trim(),
        link: (link[1] ?? link[2] ?? '').trim(),
        pubDate: (pubDate?.[1] ?? new Date().toISOString()).trim(),
        description: (desc?.[1] ?? desc?.[2] ?? '').trim().substring(0, 300)
      });
    }
  }
  return items;
}

/** Extract text between tags */
export function extractText(html: string, pattern: RegExp): string {
  return html.match(pattern)?.[1]?.trim() ?? '';
}
