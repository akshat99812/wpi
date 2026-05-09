"use client";

import React from 'react';
import type { WpiBundle } from '@/lib/types';
import {
  HeadlineMetric, InfoCard, Prose, ChipRow,
  SectionHeader, EmptyState, SourceLinks,
} from '../WindCards';
import { useTariffsData } from '@/hooks/useApi';

interface Props {
  bundle?:        WpiBundle;
  selectedState?: string | null;
}

const TARIFF_BAND = {
  low:    2.83,
  high:   3.24,
  median: 3.05,
};

const SOURCES = [
  { label: 'SECI Auction Results', url: 'https://www.seci.co.in/' },
  { label: 'CERC Tariff Orders',   url: 'https://cercind.gov.in/' },
  { label: 'MERC / GERC / KERC',   url: 'https://forumofregulators.gov.in/' },
];

export default function TariffsSection({ bundle: _bundle, selectedState }: Props) {
  const { data, loading, refetch } = useTariffsData();

  const auctions     = data?.auctions ?? [];
  const lendingRates = data?.lendingRates ?? [];
  const filteredOrders = selectedState
    ? (data?.tariffOrders ?? []).filter(t => !t.state || t.state === selectedState || t.regulator?.includes('CERC'))
    : (data?.tariffOrders ?? []);

  if (loading) {
    return (
      <div className="flex flex-col gap-3.5">
        <SectionHeader eyebrow="Discovered Tariffs" title="Tariffs — Auctions, Orders, Finance" delay={0} />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {[1, 2, 3].map(i => (
            <div key={i} className="bg-[#0f1424] border border-[#2a3a54] rounded-xl p-4 animate-pulse">
              <div className="h-3 bg-[#1f2c44] rounded w-20 mb-3" />
              <div className="h-8 bg-[#1f2c44] rounded w-32 mb-2" />
              <div className="h-3 bg-[#1f2c44] rounded w-full" />
            </div>
          ))}
        </div>
        <div className="bg-[#0f1424] border border-[#2a3a54] rounded-xl p-4 animate-pulse h-40" />
      </div>
    );
  }

  const latestAuction = auctions.find(a => a.tariffL1Inr != null);
  const l1Tariff = latestAuction?.tariffL1Inr ?? TARIFF_BAND.median;

  return (
    <div className="flex flex-col gap-3.5">
      <div className="flex items-start justify-between gap-2">
        <SectionHeader
          eyebrow="Discovered Tariffs"
          title={selectedState ? `${selectedState} & CERC Tariffs` : 'Tariffs — Auctions, Orders, Finance'}
          delay={0}
        />
        <button
          onClick={refetch}
          className="flex-shrink-0 mt-1 text-[9px] font-bold uppercase tracking-wider px-2.5 py-1.5 rounded-md border border-[#1f2c44] text-muted/50 hover:text-text hover:border-[#2a3a54] transition-all"
          title="Refresh tariffs"
        >
          ↻ Refresh
        </button>
      </div>

      {/* Headline metrics */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <HeadlineMetric
          delay={60} emphasis accent="#4cc87a"
          label="Latest L1 Tariff"
          value={`₹${l1Tariff}/kWh`}
          caption={latestAuction
            ? `${latestAuction.issuer} ${latestAuction.tranche} · ${new Date(latestAuction.resultDate).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })}`
            : 'SECI Tranche XV indicative'}
        />
        <HeadlineMetric
          delay={120} emphasis accent="#ff8a1f"
          label="Benchmark Band"
          value={`₹${TARIFF_BAND.low} – ${TARIFF_BAND.high}`}
          caption="SECI XII–XV + MSEDCL FDRE recent rounds"
        />
        <HeadlineMetric
          delay={180} emphasis accent="#7bc4e2"
          label="Auctions Tracked"
          value={`${auctions.length}`}
          caption={auctions.length ? `Across SECI / GUVNL / MSEDCL / state` : 'No live auction data in bundle'}
        />
      </div>

      {/* SECI / state auction results */}
      <InfoCard
        title="SECI / State auction results"
        delay={240}
        defaultOpen
        icon={<GavelIcon />}
        accent="#ff8a1f"
      >
        <Prose>
          Wind tariffs have stabilised in the <b className="text-[#4cc87a]">₹2.83 – ₹3.24/kWh</b> band
          across SECI ISTS rounds and state utility tenders. FDRE rounds bundling
          wind + solar + BESS price ~₹0.20–0.40 higher to compensate for storage capex.
        </Prose>

        {auctions.length ? (
          <div className="flex flex-col gap-2.5 mt-1">
            {auctions.map((a, i) => (
              <div
                key={i}
                className="bg-[#0a0f1c]/60 border border-[#1f2c44] rounded-lg p-3.5 hover:border-orange/40 transition-colors flex items-start justify-between gap-3"
              >
                <div className="flex-1 min-w-0">
                  <div className="text-[11px] text-orange font-bold uppercase tracking-wider">
                    {a.issuer}
                  </div>
                  <div className="text-[12px] text-text/85 mt-0.5 truncate">{a.tranche}</div>
                  <div className="flex gap-3 mt-1.5 flex-wrap text-[10px] text-muted/70">
                    <span>Capacity: <b className="text-text/85">{a.capacityMw.toLocaleString()} MW</b></span>
                    <span>{new Date(a.resultDate).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })}</span>
                  </div>
                </div>
                <span className="text-[20px] font-black font-mono text-[#ffd0a0] tabular-nums leading-none flex-shrink-0">
                  ₹{a.tariffL1Inr}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState message="No auction data in bundle." />
        )}
        <ViewSource href="https://www.seci.co.in/page.php?id=68" label="View auction results on SECI" accent="#ff8a1f" />
      </InfoCard>

      {/* Regulator tariff orders */}
      <InfoCard
        title="Regulator tariff orders"
        delay={300}
        icon={<ScaleIcon />}
        accent="#ffb066"
      >
        <Prose>
          Generic preferential tariffs published by CERC and SERCs for
          non-bid wind. State orders apply to TANGEDCO / MSEDCL / GUVNL etc.
          legacy and non-auction procurement.
        </Prose>

        {filteredOrders?.length ? (
          <div className="flex flex-col gap-2 mt-1">
            {filteredOrders.map((t, i) => (
              <div
                key={i}
                className="bg-[#0a0f1c]/60 border border-[#1f2c44] rounded-lg p-3 hover:border-orange/40 transition-colors"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[12px] font-bold text-text/90">{t.state ?? t.regulator}</span>
                  {t.tariff_inr && (
                    <span className="font-mono text-[#ffd0a0] font-bold text-[12.5px] tabular-nums">
                      ₹{t.tariff_inr}/kWh
                    </span>
                  )}
                </div>
                <div className="flex gap-2 text-[9.5px] text-muted/70 flex-wrap mt-1.5">
                  {t.regulator && <span className="font-medium">{t.regulator}</span>}
                  {t.category && <span className="px-1.5 py-0.5 bg-[#1a2a44] rounded text-[9px] font-medium">{t.category}</span>}
                  {t.effectiveDate && <span>{new Date(t.effectiveDate).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })}</span>}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState message="No tariff orders in bundle for this selection." />
        )}
        <ViewSource href="https://cercind.gov.in/Tariff/tariff.html" label="View tariff orders on CERC" accent="#ffb066" />
      </InfoCard>

      {/* Project finance — lending rates */}
      <InfoCard
        title="Project finance — lending rates"
        delay={360}
        icon={<BankIcon />}
        accent="#a5b4fc"
      >
        <Prose>
          PFC, REC, IREDA and IIFCL provide the bulk of long-tenor wind
          project debt. Tenor 15–18 yr, moratorium 18–24 m, rate band
          <b className="text-[#a5b4fc]"> 8.5 – 10.25% </b> reflecting
          repo + ALCO spread.
        </Prose>

        {lendingRates.length ? (
          <div className="flex flex-col gap-2 mt-1">
            {lendingRates.map((l, i) => (
              <div
                key={i}
                className="flex items-center justify-between bg-[#0a0f1c]/60 border border-[#1f2c44] rounded-lg p-3 hover:border-orange/40 transition-colors gap-3"
              >
                <div className="flex-1 min-w-0">
                  <div className="text-[12px] font-bold text-text/90">{l.institution}</div>
                  <div className="text-[10px] text-muted/70 mt-0.5">
                    {l.product} · {l.tenor_yrs} yr · {l.moratorium_months}m moratorium
                  </div>
                </div>
                <span className="font-mono font-black text-[#ffd0a0] text-[18px] tabular-nums leading-none">
                  {l.rate_pct}%
                </span>
              </div>
            ))}
          </div>
        ) : (
          <ChipRow chips={[
            { label: 'PFC',   value: '~9.25%', accent: '#a5b4fc' },
            { label: 'REC',   value: '~9.40%', accent: '#a5b4fc' },
            { label: 'IREDA', value: '~9.75%', accent: '#a5b4fc' },
            { label: 'Banks', value: '8.5 – 10.25%' },
          ]} />
        )}
        <div className="flex flex-wrap gap-3 mt-2">
          <ViewSource href="https://www.pfcindia.com/Home/VS/43" label="PFC Lending" accent="#a5b4fc" />
          <ViewSource href="https://www.recindia.nic.in/" label="REC India" accent="#a5b4fc" />
          <ViewSource href="https://www.ireda.in/" label="IREDA" accent="#a5b4fc" />
        </div>
      </InfoCard>

      <SourceLinks sources={SOURCES} delay={420} />
    </div>
  );
}

const ExternalLinkIcon = () => (
  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
    <polyline points="15 3 21 3 21 9" />
    <line x1="10" y1="14" x2="21" y2="3" />
  </svg>
);

function ViewSource({ href, label, accent = '#ff8a1f' }: { href: string; label: string; accent?: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 mt-2 text-[10px] font-semibold uppercase tracking-wider hover:opacity-80 transition-opacity"
      style={{ color: accent }}
    >
      {label}
      <ExternalLinkIcon />
    </a>
  );
}

const GavelIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14 4l6 6M9 9l6 6M3 21l6-6M11 5l4-1 5 5-1 4z" />
  </svg>
);
const ScaleIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 3v18M5 21h14M5 8l-2 6h4zM19 8l-2 6h4zM12 5l-7 3M12 5l7 3" />
  </svg>
);
const BankIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 9l9-6 9 6M5 10v9M19 10v9M9 10v9M15 10v9M3 21h18" />
  </svg>
);
