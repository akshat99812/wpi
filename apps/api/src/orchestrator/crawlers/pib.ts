import { SourceResult } from '../merge';
import { politeFetch, parseRssItems } from '../httpClient';

export const pibCrawler = {
  key: 'pib',
  name: 'Press Information Bureau',
  async run(): Promise<SourceResult> {
    const fetchedAt = new Date();
    try {
      // PIB RSS for Ministry of New & Renewable Energy (ModId=6)
      const res = await politeFetch('https://pib.gov.in/RssMain.aspx?ModId=6&Lang=1&Regid=3');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const xml = await res.text();
      const items = parseRssItems(xml);
      const policies = items
        .filter(i => /wind|renewable|mnre|energy/i.test(i.title + (i.description ?? '')))
        .slice(0, 12)
        .map(i => ({
          title: i.title,
          url: i.link,
          publishedAt: new Date(i.pubDate).toISOString(),
          source: 'PIB',
          category: /wind/i.test(i.title) ? 'Wind' :
                    /offshore/i.test(i.title) ? 'Offshore' :
                    /repow/i.test(i.title) ? 'Repowering' : 'General',
          summary: i.description
        }));
      return { source: 'pib', fetchedAt, ok: true, payload: { policies, news: policies } };
    } catch (err) {
      return {
        source: 'pib', fetchedAt, ok: false,
        error: err instanceof Error ? err.message : String(err),
        payload: { policies: [], news: [] }
      };
    }
  }
};
