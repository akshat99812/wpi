"use client";

import React, { useState } from 'react';
import type { WpiBundle } from '@/lib/types';

const TABS = ['Overview', 'Auctions', 'Tariffs', 'News', 'Policies'] as const;
type Tab = typeof TABS[number];

// ── small shared primitives ───────────────────────────────────────────────────
function Pill({ color }: { color: string }) {
  return <span className="w-2 h-2 rounded-full flex-none" style={{ backgroundColor: color }} />;
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between items-center py-3 px-1 border-b border-[#1a2138] last:border-0 hover:bg-[#0f1424]/40 transition-colors">
      <span className="text-[12px] text-muted/80 font-medium">{label}</span>
      <span className="text-[13px] font-mono font-bold text-[#ffd0a0]">{value}</span>
    </div>
  );
}

function CollapsibleCard({ title, children, defaultOpen = false }: { title: string, children: React.ReactNode, defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="bg-gradient-to-b from-[#0f1424] to-[#0d1220] border border-[#2a3a54] rounded-lg flex flex-col overflow-hidden shadow-sm">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex justify-between items-center px-5 py-3.5 bg-[#0a0f1c] hover:bg-[#141e35] transition-colors"
      >
        <div className="text-[11px] text-orange uppercase font-bold tracking-wider">{title}</div>
        <span className={`text-[11px] text-muted transition-transform duration-200 ${open ? 'rotate-180' : ''}`}>▼</span>
      </button>
      {open && (
        <div className="px-5 py-3.5 border-t border-[#1a2a44]">
          {children}
        </div>
      )}
    </div>
  );
}

function NewsCard({ item }: { item: WpiBundle['news'][0] }) {
  const d = item.publishedAt ? new Date(item.publishedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: '2-digit' }) : '';
  return (
    <a href={item.url} target="_blank" rel="noopener noreferrer"
      className="block bg-gradient-to-br from-[#0f1424] to-[#0d1220] border border-[#2a3a54] rounded-lg p-4 hover:border-orange/60 hover:shadow-lg transition-all duration-200 group">
      <div className="flex items-start gap-2.5 mb-2">
        <Pill color="#ff8a1f" />
        <span className="text-[11px] text-orange font-bold uppercase tracking-wide">{item.source}</span>
        <span className="text-[10px] text-muted/60 ml-auto">{d}</span>
      </div>
      <p className="text-[13px] text-text leading-relaxed group-hover:text-orange-200 transition-colors font-medium">{item.headline}</p>
    </a>
  );
}

function PolicyCard({ item }: { item: WpiBundle['policies'][0] }) {
  const d = item.publishedAt ? new Date(item.publishedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: '2-digit' }) : '';
  return (
    <a href={item.url} target="_blank" rel="noopener noreferrer"
      className="block bg-gradient-to-br from-[#0f1424] to-[#0d1220] border border-[#2a3a54] rounded-lg p-4 hover:border-orange/60 hover:shadow-lg transition-all duration-200 group">
      <div className="flex items-center gap-2.5 mb-2">
        <span className="text-[10px] px-2.5 py-1 bg-orange/15 text-orange rounded-md font-bold uppercase">{item.category}</span>
        <span className="text-[10px] text-muted/60 ml-auto">{d}</span>
      </div>
      <p className="text-[13px] text-text leading-relaxed group-hover:text-orange-200 transition-colors font-medium">{item.title}</p>
    </a>
  );
}

interface Props {
  bundle?: WpiBundle;
  selectedState?: string | null;
}

export default function TabPanel({ bundle, selectedState }: Props) {
  const [active, setActive] = useState<Tab>('Overview');

  const stateCap = selectedState ? bundle?.stateCapacity?.find(s => s.state === selectedState) : null;
  const filteredTariffs = selectedState 
    ? bundle?.tariffOrders?.filter(t => !t.state || t.state === selectedState || t.regulator?.includes('CERC'))
    : bundle?.tariffOrders;

  return (
    <div className="flex flex-col h-full bg-[#0a0f1c]/50">
      {/* Tab bar (sticky) */}
      <div className="flex gap-1 border-b border-[#2a3a54] px-4 pt-3 pb-0 flex-none overflow-x-auto bg-[#0a0f1c] z-10 sticky top-0 shadow-md">
        {TABS.map(tab => (
          <button key={tab} onClick={() => setActive(tab)}
            className={`px-4 py-3 text-[12px] font-bold whitespace-nowrap border-b-2 transition-colors ${
              active === tab ? 'border-orange text-[#ffd0a0]' : 'border-transparent text-muted hover:text-text'}`}>
            {tab}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto custom-scrollbar px-4 py-4">
        {/* ── Overview ── */}
        {active === 'Overview' && (
          <div className="flex flex-col gap-4">
            <div className="text-[12px] text-orange uppercase font-bold tracking-wider mb-1">
              {selectedState ? `${selectedState} Wind Profile` : 'India Wind at a Glance'}
            </div>

            <div className="bg-gradient-to-b from-[#0f1424] to-[#0d1220] border border-[#2a3a54] rounded-lg p-5 flex flex-col shadow-sm">
              {selectedState ? (
                <>
                  <Row label="State Installed" value={stateCap?.installed_mw ? `${(stateCap.installed_mw / 1000).toFixed(2)} GW` : 'N/A'} />
                  <Row label="State Potential @120m" value={stateCap?.potential_120m_gw ? `${stateCap.potential_120m_gw.toFixed(1)} GW` : 'N/A'} />
                  <Row label="State Potential @150m" value={stateCap?.potential_150m_gw ? `${stateCap.potential_150m_gw.toFixed(1)} GW` : 'N/A'} />
                </>
              ) : (
                <>
                  <Row label="Installed Capacity"  value={bundle?.capacity ? `${(bundle.capacity.installed_mw / 1000).toFixed(1)} GW` : '48.2 GW'} />
                  <Row label="FY30 MNRE Target"    value={bundle?.capacity ? `${(bundle.capacity.target_fy_mw / 1000).toFixed(0)} GW` : '100 GW'} />
                  <Row label="Potential @150m"     value="1,164 GW" />
                  <Row label="Potential @120m"     value="695 GW" />
                  <Row label="Offshore Potential"  value="~70 GW" />
                  <Row label="National Avg PLF"    value="~24%" />
                  <Row label="Top-Decile PLF"      value="38 – 42%" />
                  <Row label="SECI L1 Tariff"      value={bundle?.auctions?.[0] ? `₹${bundle.auctions[0].tariffL1Inr}/kWh` : '₹3.15/kWh'} />
                  <Row label="Annual Additions"    value="~7 – 10 GW / yr" />
                  <Row label="Grid Share (wind)"   value={bundle?.grid ? `${bundle.grid.wind_grid_share_pct}%` : '~5.4%'} />
                </>
              )}
            </div>

            {bundle?.windAtlas && (
              <CollapsibleCard title="Global Wind Atlas — India">
                <Row label="Mean Speed @100m"       value={`${bundle.windAtlas.mean_wind_speed_100m} m/s`} />
                {bundle.windAtlas.mean_wind_speed_150m && <Row label="Mean Speed @150m" value={`${bundle.windAtlas.mean_wind_speed_150m} m/s`} />}
                {bundle.windAtlas.exploitable_potential_150m_gw && <Row label="Exploitable @150m" value={`${bundle.windAtlas.exploitable_potential_150m_gw.toLocaleString()} GW`} />}
              </CollapsibleCard>
            )}

            {bundle?.grid && !selectedState && (
              <CollapsibleCard title={`POSOCO Grid Data — ${bundle.grid.date}`}>
                <Row label="Daily Wind Gen"     value={`${bundle.grid.daily_wind_gen_mu} MU`} />
                <Row label="Wind Grid Share"    value={`${bundle.grid.wind_grid_share_pct}%`} />
                <Row label="Curtailment"        value={`${bundle.grid.curtailment_pct}%`} />
              </CollapsibleCard>
            )}
          </div>
        )}

        {/* ── Auctions ── */}
        {active === 'Auctions' && (
          <div className="flex flex-col gap-4">
            <div className="text-[12px] text-orange uppercase font-bold tracking-wider mb-1">SECI / State Auction Results</div>
            {bundle?.auctions?.length ? bundle.auctions.map((a, i) => (
              <div key={i} className="bg-gradient-to-b from-[#0f1424] to-[#0d1220] border border-[#2a3a54] rounded-lg p-4 flex flex-col gap-3 shadow-sm">
                <div className="flex justify-between items-start">
                  <div>
                    <div className="text-[11px] text-orange font-bold uppercase tracking-wide">{a.issuer}</div>
                    <div className="text-[12px] text-muted/80">{a.tranche}</div>
                  </div>
                  <span className="text-2xl font-black font-mono text-[#ffd0a0]">₹{a.tariffL1Inr}</span>
                </div>
                <div className="flex gap-4 text-[11px] text-muted/80">
                  <span>Capacity: <b className="text-text text-[12px]">{a.capacityMw.toLocaleString()} MW</b></span>
                  <span>Result: <b className="text-text text-[12px]">{new Date(a.resultDate).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })}</b></span>
                </div>
              </div>
            )) : (
              <div className="text-muted text-sm text-center py-8">No auction data in bundle</div>
            )}

            {/* OEM models */}
            {bundle?.oemModels?.length ? (
              <div className="mt-2">
                <CollapsibleCard title="ALMM-II Turbine Models">
                  <div className="overflow-x-auto">
                    <table className="w-full text-[11px] border-collapse">
                      <thead>
                        <tr className="text-muted/70 text-[10px] uppercase tracking-wide border-b border-[#1a2a44]">
                          <th className="text-left py-2.5 font-bold">OEM</th>
                          <th className="text-left py-2.5 font-bold">Model</th>
                          <th className="text-right py-2.5 font-bold">kW</th>
                          <th className="text-right py-2.5 font-bold">Rotor</th>
                          <th className="text-right py-2.5 font-bold">Hub</th>
                          <th className="text-center py-2.5 font-bold">ALMM</th>
                        </tr>
                      </thead>
                      <tbody>
                        {bundle.oemModels.map((m, i) => (
                          <tr key={i} className="border-b border-[#1a2a44] last:border-0 hover:bg-[#0f1424]/40 transition-colors">
                            <td className="py-2 text-text font-medium">{m.oem}</td>
                            <td className="py-2 text-muted/80">{m.model}</td>
                            <td className="py-2 text-right font-mono text-[#ffd0a0]">{m.rated_kw.toLocaleString()}</td>
                            <td className="py-2 text-right font-mono text-muted/80">{m.rotor_m}m</td>
                            <td className="py-2 text-right font-mono text-muted/80">{m.hub_height_m}m</td>
                            <td className="py-2 text-center">{m.almm ? '✓' : '–'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </CollapsibleCard>
              </div>
            ) : null}
          </div>
        )}

        {/* ── Tariffs ── */}
        {active === 'Tariffs' && (
          <div className="flex flex-col gap-4">
            <div className="text-[12px] text-orange uppercase font-bold tracking-wider mb-1">
              {selectedState ? `${selectedState} & CERC Tariffs` : 'Regulator Tariff Orders'}
            </div>
            {filteredTariffs?.length ? filteredTariffs.map((t, i) => (
              <div key={i} className="bg-gradient-to-b from-[#0f1424] to-[#0d1220] border border-[#2a3a54] rounded-lg p-4 flex flex-col gap-2 shadow-sm">
                <div className="flex justify-between">
                  <span className="text-[12px] font-bold text-text">{t.state ?? t.regulator}</span>
                  {t.tariff_inr && <span className="font-mono text-[#ffd0a0] font-bold text-[12px]">₹{t.tariff_inr}/kWh</span>}
                </div>
                <div className="flex gap-2.5 text-[10px] text-muted/80 flex-wrap">
                  {t.regulator && <span className="font-medium">{t.regulator}</span>}
                  {t.category && <span className="px-2 py-1 bg-[#1a2a44] rounded text-[9px] font-medium">{t.category}</span>}
                  {t.effectiveDate && <span>{new Date(t.effectiveDate).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })}</span>}
                </div>
              </div>
            )) : (
              <div className="text-muted text-sm text-center py-8">No tariff data available for this selection</div>
            )}

            {/* Lending rates */}
            {bundle?.lendingRates?.length && !selectedState ? (
              <div className="mt-2">
                <CollapsibleCard title="Project Finance — Lending Rates">
                  <div className="flex flex-col gap-2.5">
                    {bundle.lendingRates.map((l, i) => (
                      <div key={i} className="flex justify-between items-center py-3 px-1 border-b border-[#1a2a44] last:border-0 hover:bg-[#0f1424]/40 transition-colors">
                        <div>
                          <div className="text-[12px] font-bold text-text">{l.institution}</div>
                          <div className="text-[11px] text-muted/80">{l.product} · {l.tenor_yrs} yr · {l.moratorium_months}m moratorium</div>
                        </div>
                        <span className="font-mono font-black text-[#ffd0a0] text-lg">{l.rate_pct}%</span>
                      </div>
                    ))}
                  </div>
                </CollapsibleCard>
              </div>
            ) : null}
          </div>
        )}

        {/* ── News ── */}
        {active === 'News' && (
          <div className="flex flex-col gap-3.5">
            <div className="text-[12px] text-orange uppercase font-bold tracking-wider mb-1">Live Wind Energy News</div>
            {bundle?.news?.length ? bundle.news.map((n, i) => (
              <NewsCard key={i} item={n} />
            )) : (
              <div className="text-muted text-sm text-center py-8">No news in bundle — run the orchestrator to fetch live RSS feeds</div>
            )}
          </div>
        )}

        {/* ── Policies ── */}
        {active === 'Policies' && (
          <div className="flex flex-col gap-3.5">
            <div className="text-[12px] text-orange uppercase font-bold tracking-wider mb-1">Policy Notifications (PIB / MNRE)</div>
            {bundle?.policies?.length ? bundle.policies.map((p, i) => (
              <PolicyCard key={i} item={p} />
            )) : (
              <div className="text-muted text-sm text-center py-8">No policy notifications in bundle</div>
            )}

            {bundle?.analystReports?.length ? (
              <div className="mt-2">
                <CollapsibleCard title="Analyst Reports">
                  <div className="flex flex-col gap-3">
                    {bundle.analystReports.map((r, i) => (
                      <a key={i} href={r.url} target="_blank" rel="noopener noreferrer"
                        className="block bg-gradient-to-br from-[#0f1424] to-[#0d1220] border border-[#2a3a54] rounded-lg p-4 hover:border-orange/60 hover:shadow-lg transition-all duration-200">
                        <div className="text-[12px] text-text font-bold">{r.title}</div>
                        <div className="text-[10px] text-muted/80 mt-1">{r.analyst} · {r.date}</div>
                      </a>
                    ))}
                  </div>
                </CollapsibleCard>
              </div>
            ) : null}
          </div>
        )}

      </div>
    </div>
  );
}
