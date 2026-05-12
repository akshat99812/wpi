/**
 * State-specific wind news aggregator.
 *
 * Queries Google News RSS (which aggregates Mercom India, Economic Times,
 * Hindu BusinessLine, PV Magazine, Reuters, state-utility sites, etc.) for
 * state-specific wind keywords — state name + prime districts + utilities.
 *
 * Results are cached per-state in-memory for 30 minutes so repeated clicks
 * on the same state don't hammer Google News, and cold starts on Render
 * don't refetch every time.
 */

interface NewsItem {
  headline:    string;
  url:         string;
  publishedAt: string;
  source:      string;
  summary?:    string;
}

interface CacheEntry {
  items:     NewsItem[];
  fetchedAt: number;
}

const cache  = new Map<string, CacheEntry>();
const TTL_MS = 30 * 60 * 1000; // 30 minutes

// Per-state Google News queries. Each query is run independently and results
// are deduped by URL. Queries target the state name plus a handful of
// districts / utilities / corridors so we catch headlines like
// "GUVNL awards 600 MW wind" that don't mention "Gujarat" directly.
const STATE_QUERIES: Record<string, string[]> = {
  'Andhra Pradesh': [
    '"Andhra Pradesh" wind energy',
    'Anantapur wind power',
    'Kurnool wind farm',
    'NREDCAP wind',
  ],
  'Gujarat': [
    'Gujarat wind energy',
    'GUVNL wind tender',
    'Kutch wind farm',
    'Khavda renewable',
    'Gulf of Kutch offshore wind',
  ],
  'Himachal Pradesh': [
    '"Himachal Pradesh" wind energy',
    'HIMURJA wind',
    'Spiti wind project',
  ],
  'Karnataka': [
    'Karnataka wind energy',
    'KREDL wind',
    'Chitradurga wind farm',
    'Gadag wind power',
    'Pavagada hybrid',
  ],
  'Kerala': [
    'Kerala wind energy',
    'Palakkad wind',
    'KSEB wind',
    'ANERT wind',
  ],
  'Madhya Pradesh': [
    '"Madhya Pradesh" wind energy',
    'MPPMCL wind tender',
    'Dhar wind farm',
    'MPUVNL wind',
    'Ratlam wind power',
  ],
  'Maharashtra': [
    'Maharashtra wind energy',
    'MSEDCL wind tender',
    'Satara wind farm',
    'MAHATRANSCO wind',
    'Dhule wind',
    'FDRE Maharashtra',
  ],
  'Odisha': [
    'Odisha wind energy',
    'GRIDCO wind',
    'OREDA wind tender',
    'Paradip offshore wind',
  ],
  'Rajasthan': [
    'Rajasthan wind energy',
    'Jaisalmer wind farm',
    'Barmer wind power',
    'RRECL wind',
    'Bhadla renewable',
    'Khimsar wind',
  ],
  'Tamil Nadu': [
    '"Tamil Nadu" wind energy',
    'TANGEDCO wind',
    'Tirunelveli wind farm',
    'Muppandal wind',
    'Tuticorin wind power',
    'Gulf of Mannar offshore wind',
  ],
  'Telangana': [
    'Telangana wind energy',
    'TSREDCO wind',
    'Narayanpet wind',
    'Hyderabad open access wind',
  ],
};

// ── Minimal RSS parser tuned for Google News ─────────────────────────────
// Google News items look like:
//   <item>
//     <title>Headline — Source Name</title>
//     <link>https://news.google.com/articles/...</link>
//     <pubDate>Mon, 12 May 2025 10:00:00 GMT</pubDate>
//     <description>CDATA HTML with citation</description>
//     <source url="https://example.com">Example Source</source>
//   </item>
function parseGoogleNewsItems(xml: string): NewsItem[] {
  const out: NewsItem[] = [];
  const itemRe = /<item[^>]*>([\s\S]*?)<\/item>/gi;

  let m: RegExpExecArray | null;
  while ((m = itemRe.exec(xml)) !== null) {
    const body  = m[1] ?? '';
    const title = pick(body, /<title[^>]*>(?:<!\[CDATA\[([\s\S]*?)\]\]>|([\s\S]*?))<\/title>/i);
    const link  = pick(body, /<link[^>]*>([\s\S]*?)<\/link>/i);
    const pub   = pick(body, /<pubDate[^>]*>([\s\S]*?)<\/pubDate>/i);
    const desc  = pick(body, /<description[^>]*>(?:<!\[CDATA\[([\s\S]*?)\]\]>|([\s\S]*?))<\/description>/i);
    const srcEl = pick(body, /<source[^>]*>([\s\S]*?)<\/source>/i);

    if (!title || !link) continue;

    // Google News titles end in " - Source Name"; prefer the <source> tag
    // when present, otherwise split the title.
    let source   = srcEl?.trim() || '';
    let headline = title.trim();
    if (!source) {
      const dash = headline.lastIndexOf(' - ');
      if (dash > 0) {
        source   = headline.slice(dash + 3).trim();
        headline = headline.slice(0, dash).trim();
      } else {
        source = 'Google News';
      }
    } else {
      // Title may still contain the trailing " - Source"; strip it.
      const trailing = ` - ${source}`;
      if (headline.endsWith(trailing)) {
        headline = headline.slice(0, -trailing.length).trim();
      }
    }

    const publishedAt = pub
      ? new Date(pub).toISOString()
      : new Date().toISOString();

    const summary = desc
      ? stripHtml(desc).slice(0, 280)
      : undefined;

    out.push({ headline, url: link.trim(), publishedAt, source, summary });
  }

  return out;
}

function pick(body: string, re: RegExp): string | undefined {
  const m = body.match(re);
  if (!m) return undefined;
  return (m[1] ?? m[2] ?? '').trim();
}

function stripHtml(s: string): string {
  return s
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

async function fetchGoogleNewsRss(query: string): Promise<NewsItem[]> {
  const url =
    `https://news.google.com/rss/search?q=${encodeURIComponent(query)}` +
    `&hl=en-IN&gl=IN&ceid=IN:en`;

  const res = await fetch(url, {
    headers: {
      'User-Agent':
        'WindPowerIndia-NewsAggregator/1.0 (RSS reader)',
      'Accept': 'application/rss+xml, application/xml, text/xml, */*',
    },
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) {
    throw new Error(`Google News RSS HTTP ${res.status}`);
  }
  const xml = await res.text();
  return parseGoogleNewsItems(xml);
}

export async function fetchStateNews(state: string): Promise<{
  generatedAt: string;
  state:       string;
  news:        NewsItem[];
  cached:      boolean;
}> {
  const cached = cache.get(state);
  if (cached && Date.now() - cached.fetchedAt < TTL_MS) {
    return {
      generatedAt: new Date(cached.fetchedAt).toISOString(),
      state,
      news:        cached.items,
      cached:      true,
    };
  }

  const queries  = STATE_QUERIES[state] ?? [`"${state}" wind energy India`];
  const seenUrls = new Set<string>();
  const merged: NewsItem[] = [];

  // Run queries sequentially with a small gap to be polite.
  for (const q of queries) {
    try {
      const items = await fetchGoogleNewsRss(q);
      for (const it of items) {
        if (seenUrls.has(it.url)) continue;
        seenUrls.add(it.url);
        merged.push(it);
      }
    } catch (err) {
      console.error(`[stateNews] query "${q}" failed:`, err);
    }
    // 600 ms gap between queries — Google News tolerates this fine.
    await new Promise(r => setTimeout(r, 600));
  }

  // Sort newest-first, cap to 30 items.
  merged.sort((a, b) => +new Date(b.publishedAt) - +new Date(a.publishedAt));
  const top = merged.slice(0, 30);

  cache.set(state, { items: top, fetchedAt: Date.now() });

  return {
    generatedAt: new Date().toISOString(),
    state,
    news:        top,
    cached:      false,
  };
}
