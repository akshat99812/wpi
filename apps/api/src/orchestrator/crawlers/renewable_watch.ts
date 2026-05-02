import { SourceResult } from '../merge';
import { politeFetch, parseRssItems } from '../httpClient';

export const renewableWatchCrawler = {
  key: 'renewable_watch',
  name: 'Renewable Watch',
  async run(): Promise<SourceResult> {
    const fetchedAt = new Date();
    try {
      const res = await politeFetch('https://renewablewatch.in/feed/');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const xml = await res.text();
      const items = parseRssItems(xml);
      const news = items
        .filter(i => /wind/i.test(i.title + (i.description ?? '')))
        .slice(0, 10)
        .map(i => ({
          headline: i.title,
          url: i.link,
          publishedAt: new Date(i.pubDate).toISOString(),
          source: 'Renewable Watch',
          summary: i.description
        }));
      return { source: 'renewable_watch', fetchedAt, ok: true, payload: { news } };
    } catch (err) {
      return {
        source: 'renewable_watch', fetchedAt, ok: false,
        error: err instanceof Error ? err.message : String(err),
        payload: { news: [] }
      };
    }
  }
};
