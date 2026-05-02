import { SourceResult } from '../merge';
import { politeFetch, parseRssItems } from '../httpClient';

export const mercomCrawler = {
  key: 'mercom',
  name: 'Mercom India Research',
  async run(): Promise<SourceResult> {
    const fetchedAt = new Date();
    try {
      const res = await politeFetch('https://mercomindia.com/feed/?cat=wind');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const xml = await res.text();
      const items = parseRssItems(xml);
      const news = items.slice(0, 15).map(i => ({
        headline: i.title,
        url: i.link,
        publishedAt: new Date(i.pubDate).toISOString(),
        source: 'Mercom India',
        summary: i.description
      }));
      return { source: 'mercom', fetchedAt, ok: true, payload: { news } };
    } catch (err) {
      return {
        source: 'mercom', fetchedAt, ok: false,
        error: err instanceof Error ? err.message : String(err),
        payload: { news: [] }
      };
    }
  }
};
