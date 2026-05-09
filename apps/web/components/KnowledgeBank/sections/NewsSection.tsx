"use client";

import React, { useMemo, useState, useEffect, useCallback } from 'react';
import type { WpiBundle } from '@/lib/types';
import { SectionHeader, EmptyState, InfoCard } from '../WindCards';

interface Props {
  bundle?:        WpiBundle;
  selectedState?: string | null;
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'https://wpi-sjse.onrender.com';

export default function NewsSection({ bundle }: Props) {
  // Seed with bundle data immediately (no loading flash), then upgrade with fresh API data
  const [news, setNews] = useState<WpiBundle['news']>(bundle?.news ?? []);
  const [analystReports, setAnalystReports] = useState(bundle?.analystReports ?? []);
  const [fetching, setFetching] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const fetchNews = useCallback(async () => {
    setFetching(true);
    setFetchError(null);
    try {
      const res = await fetch(`${API_BASE}/api/news`);
      if (!res.ok) throw new Error(`${res.status}`);
      const data = await res.json();
      if (Array.isArray(data.news) && data.news.length > 0) {
        setNews(data.news);
        setAnalystReports(data.analystReports ?? []);
      }
    } catch (e) {
      setFetchError(e instanceof Error ? e.message : 'Error');
    } finally {
      setFetching(false);
    }
  }, []);

  useEffect(() => { fetchNews(); }, [fetchNews]);

  const sources = useMemo(() => {
    const set = new Set(news.map(n => n.source));
    return ['All', ...Array.from(set).sort()];
  }, [news]);

  const [activeSource, setActiveSource] = useState<string>('All');

  const filtered = activeSource === 'All'
    ? news
    : news.filter(n => n.source === activeSource);

  return (
    <div className="flex flex-col gap-3.5">
      <SectionHeader eyebrow="Live RSS Feed" title="News — Wind Energy India" delay={0} />

      {/* Source filter */}
      {sources.length > 1 && (
        <div className="wpi-card-in flex flex-wrap gap-1.5 items-center" style={{ ['--wpi-delay' as string]: '60ms' }}>
          {sources.map(s => {
            const active = activeSource === s;
            return (
              <button
                key={s}
                onClick={() => setActiveSource(s)}
                className={`text-[10px] font-bold uppercase tracking-wider px-3 py-1.5 rounded-md transition-all border ${
                  active
                    ? 'bg-orange/15 border-orange/50 text-orange'
                    : 'bg-[#0a0f1c]/60 border-[#1f2c44] text-muted/65 hover:text-text hover:border-[#2a3a54]'
                }`}
              >
                {s}
              </button>
            );
          })}
          <button
            onClick={fetchNews}
            disabled={fetching}
            className="ml-auto text-[9px] font-bold uppercase tracking-wider px-2.5 py-1.5 rounded-md border border-[#1f2c44] text-muted/50 hover:text-text hover:border-[#2a3a54] transition-all disabled:opacity-40"
            title="Refresh news"
          >
            {fetching ? '…' : '↻'}
          </button>
        </div>
      )}

      {fetchError && (
        <div className="text-[10px] text-red-400/70 px-1">
          API error {fetchError} — showing cached data
        </div>
      )}

      {/* News feed */}
      {filtered.length > 0 ? (
        <div className="flex flex-col gap-2.5">
          {filtered.map((n, i) => (
            <NewsItem key={`${n.url}-${i}`} item={n} delay={i * 40} />
          ))}
        </div>
      ) : fetching ? (
        <div className="flex flex-col gap-2.5">
          {[1, 2, 3, 4, 5].map(i => (
            <div key={i} className="bg-[#0f1424] border border-[#2a3a54] rounded-xl p-4 animate-pulse">
              <div className="h-3 bg-[#1f2c44] rounded w-24 mb-3" />
              <div className="h-4 bg-[#1f2c44] rounded w-full mb-1.5" />
              <div className="h-4 bg-[#1f2c44] rounded w-3/4" />
            </div>
          ))}
        </div>
      ) : (
        <EmptyState delay={0} message={news.length === 0 ? 'No news available — try refreshing.' : `No items from "${activeSource}".`} />
      )}

      {/* Analyst reports */}
      {analystReports && analystReports.length > 0 && (
        <InfoCard title="Analyst reports" delay={200} icon={<ChartIcon />} accent="#a5b4fc">
          <div className="flex flex-col gap-2 mt-1">
            {analystReports.map((r, i) => r && (
              <a
                key={i}
                href={r.url}
                target="_blank"
                rel="noopener noreferrer"
                className="block bg-[#0a0f1c]/60 border border-[#1f2c44] rounded-lg p-3 hover:border-orange/40 transition-colors"
              >
                <div className="text-[12px] text-text/90 font-bold leading-snug">{r.title}</div>
                <div className="text-[10px] text-muted/65 mt-1">{r.analyst} · {r.date}</div>
              </a>
            ))}
          </div>
        </InfoCard>
      )}
    </div>
  );
}

// ── Single news item ──────────────────────────────────────────────────────
// Card-styled link with the source pill, date, and headline. Hover lift
// matches the rest of the panel via the shared `.wpi-hover-lift` class.
function NewsItem({
  item,
  delay,
}: {
  item: WpiBundle['news'][0];
  delay: number;
}) {
  const date = item.publishedAt
    ? new Date(item.publishedAt).toLocaleDateString('en-IN', {
        day: 'numeric',
        month: 'short',
        year: '2-digit',
      })
    : '';

  return (
    <a
      href={item.url}
      target="_blank"
      rel="noopener noreferrer"
      className="wpi-card-in wpi-hover-lift group block bg-gradient-to-br from-[#0f1424] to-[#0d1220] border border-[#2a3a54] rounded-xl p-4"
      style={{ ['--wpi-delay' as string]: `${delay}ms` }}
    >
      <div className="flex items-center gap-2 mb-2">
        <span className="w-1.5 h-1.5 rounded-full bg-orange flex-shrink-0" />
        <span className="text-[10px] text-orange font-bold uppercase tracking-[0.1em]">
          {item.source}
        </span>
        <span className="text-[10px] text-muted/55 ml-auto font-mono tabular-nums flex-shrink-0">
          {date}
        </span>
      </div>
      <p className="text-[12.5px] text-text/90 leading-relaxed font-medium group-hover:text-[#ffd0a0] transition-colors">
        {item.headline}
      </p>
    </a>
  );
}

const ChartIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 21h18M5 21V10M11 21V6M17 21V13" />
  </svg>
);
