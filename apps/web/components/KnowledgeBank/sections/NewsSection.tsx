"use client";

import React, { useMemo, useState, useEffect, useCallback } from 'react';
import type { WpiBundle } from '@/lib/types';
import { SectionHeader, EmptyState, InfoCard } from '../WindCards';
import { useStateNews } from '@/hooks/useApi';

interface Props {
  bundle?:        WpiBundle;
  selectedState?: string | null;
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'https://wpi-sjse.onrender.com';

export default function NewsSection({ bundle, selectedState }: Props) {
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

  // Live state-specific news via the backend Google-News aggregator. Only
  // fires when a state is selected. Re-runs whenever the state changes.
  const stateNewsApi = useStateNews(selectedState ?? null);

  // Wind-only keyword filter for the India overview. The bundle's national
  // feed mixes general renewables stories (solar, BESS, hybrid auctions)
  // because the upstream RSS sources cover all of RE. On the India overview
  // we want strictly wind-relevant headlines.
  const isWindRelevant = (n: WpiBundle['news'][0]): boolean => {
    const hay = `${n.headline} ${n.summary ?? ''} ${n.source ?? ''}`.toLowerCase();
    return /\bwind\b|turbine|\bwtg\b|offshore|repowering|niwe|fdre|suzlon|inox\s*wind|gamesa|vestas|envision|nordex|senvion|gwec|gulf of kutch|gulf of mannar|dhanushkodi|muppandal/.test(hay);
  };

  // Filter to state-relevant news when a state is selected. Match against
  // headline + summary + source (case-insensitive) using an alias list that
  // includes the state name, common short forms, prime districts, the state
  // transco/utility, and notable wind-corridor cities — most wind headlines
  // mention a district or utility rather than the state name itself.
  const { stateScopedNews, isStateFallback } = useMemo(() => {
    if (!selectedState) {
      return { stateScopedNews: news.filter(isWindRelevant), isStateFallback: false };
    }

    // Prefer the live state-news endpoint when it returned results.
    const liveStateNews = stateNewsApi.data?.news ?? [];
    if (liveStateNews.length > 0) {
      return { stateScopedNews: liveStateNews, isStateFallback: false };
    }

    const aliases: Record<string, string[]> = {
      'Andhra Pradesh':   ['andhra pradesh', 'andhra', ' ap ', 'apepdcl', 'apspdcl', 'aptransco', 'nredcap',
                            'anantapur', 'kurnool', 'nellore', 'rayalaseema', 'chittoor', 'prakasam'],
      'Gujarat':          ['gujarat', 'guvnl', 'getco', 'geda', 'kutch', 'khavda', 'jamnagar', 'rajkot',
                            'porbandar', 'bhavnagar', 'gulf of kutch', 'saurashtra'],
      'Himachal Pradesh': ['himachal pradesh', 'himachal', 'himurja', 'hpptcl', 'lahaul', 'spiti', 'chamba', 'kangra'],
      'Karnataka':        ['karnataka', 'bescom', 'kredl', 'kptcl', 'chitradurga', 'gadag', 'davangere',
                            'tumkur', 'pavagada', 'bellary', 'bagalkot'],
      'Kerala':           ['kerala', 'kseb', 'anert', 'palakkad', 'palghat', 'idukki', 'thrissur'],
      'Madhya Pradesh':   ['madhya pradesh', ' mp ', 'mppmcl', 'mpptcl', 'mpuvnl', 'mperc',
                            'dhar', 'ratlam', 'shajapur', 'ujjain', 'khargone', 'mandsaur'],
      'Maharashtra':      ['maharashtra', 'msedcl', 'mahatransco', 'meda', 'merc',
                            'satara', 'sangli', 'dhule', 'nashik', 'ahmednagar', 'nandurbar'],
      'Odisha':           ['odisha', 'orissa', 'gridco', 'oreda', 'optcl', 'kalahandi', 'koraput',
                            'bolangir', 'paradip', 'gopalpur'],
      'Rajasthan':        ['rajasthan', 'rvpn', 'rrecl', 'rerc', 'jaisalmer', 'barmer', 'jodhpur',
                            'bikaner', 'nagaur', 'thar', 'khimsar', 'bhadla', 'fatehgarh'],
      'Tamil Nadu':       ['tamil nadu', ' tn ', 'tamilnadu', 'tangedco', 'tantransco', 'teda', 'tnerc',
                            'tirunelveli', 'thoothukudi', 'tuticorin', 'coimbatore', 'muppandal',
                            'aralvaimozhi', 'kanyakumari', 'dindigul', 'palghat gap', 'gulf of mannar', 'dhanushkodi'],
      'Telangana':        ['telangana', 'tsredco', 'tstransco', 'tserc', 'narayanpet', 'mahabubnagar',
                            'jogulamba', 'nizamabad', 'hyderabad'],
    };

    const needles = (aliases[selectedState] ?? [selectedState.toLowerCase()])
      .map(s => s.toLowerCase());

    const filtered = news.filter(n => {
      const hay = `${n.headline} ${n.summary ?? ''} ${n.source ?? ''}`.toLowerCase();
      return needles.some(needle => hay.includes(needle));
    });

    // If nothing matched, fall back to the national feed with a notice
    // rather than showing an empty card — useful while the live state-news
    // endpoint is still loading on first hit (Render cold start).
    if (filtered.length === 0) {
      return { stateScopedNews: news, isStateFallback: true };
    }
    return { stateScopedNews: filtered, isStateFallback: false };
  }, [news, selectedState, stateNewsApi.data]);

  const sources = useMemo(() => {
    const set = new Set(stateScopedNews.map(n => n.source));
    return ['All', ...Array.from(set).sort()];
  }, [stateScopedNews]);

  const [activeSource, setActiveSource] = useState<string>('All');

  // Reset the source filter when the selected state changes — the source
  // list shifts (national → state) and a stale active source would otherwise
  // empty the feed.
  useEffect(() => { setActiveSource('All'); }, [selectedState]);

  const filtered = activeSource === 'All'
    ? stateScopedNews
    : stateScopedNews.filter(n => n.source === activeSource);

  return (
    <div className="flex flex-col gap-3.5">
      <SectionHeader
        eyebrow={selectedState ? `${selectedState} · Filtered Feed` : 'Live RSS Feed'}
        title={selectedState ? `News — ${selectedState}` : 'News — Wind Energy India'}
        delay={0}
      />

      {/* Live state-news loading indicator */}
      {selectedState && stateNewsApi.loading && (
        <div
          className="wpi-card-in flex items-center gap-2 bg-[#0a0f1c]/60 border border-[#1f2c44] rounded-lg px-3 py-2"
          style={{ ['--wpi-delay' as string]: '30ms' }}
        >
          <span className="w-3 h-3 rounded-full border border-orange/60 border-t-transparent animate-spin" />
          <span className="text-[10.5px] text-muted/75">
            Fetching latest <b className="text-text/85">{selectedState}</b> wind news…
          </span>
        </div>
      )}

      {/* Fallback notice — only shown after the live fetch finished without
          results AND the client-side filter also matched nothing. */}
      {selectedState && !stateNewsApi.loading && isStateFallback && news.length > 0 && (
        <div
          className="wpi-card-in flex items-start gap-2.5 bg-[#0a0f1c]/60 border border-dashed border-[#2a3a54] rounded-lg px-3 py-2.5"
          style={{ ['--wpi-delay' as string]: '40ms' }}
        >
          <span className="text-[11px] mt-0.5 leading-none">ℹ</span>
          <p className="text-[10.5px] text-muted/75 leading-relaxed">
            No recent headlines mention <b className="text-text/85">{selectedState}</b> or its
            districts / utilities. Showing the national wind feed instead.
          </p>
        </div>
      )}

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
        <EmptyState
          delay={0}
          message={
            news.length === 0
              ? 'No news available — try refreshing.'
              : `No items from "${activeSource}".`
          }
        />
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
