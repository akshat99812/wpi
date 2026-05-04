"use client";

import React, { useState } from "react";

export default function MethodologyPanel() {
  const [open, setOpen] = useState(false);
  const [expandedSection, setExpandedSection] = useState<number | null>(null);

  const methodology = [
    {
      section: "1. Generation & degradation",
      description: "Yearly net energy yield is built up from nameplate capacity, hours, plant load factor and standard wind-IPP loss assumptions, then degraded year-on-year.",
      formulas: [
        "Gross MWhY(n) = CapacityMW × 8760 × PLF",
        "Net MWhY(n) = Gross × (1 − 0.005aux) × (1 − 0.005deg)^(n−1)",
        "Generation MUY(n) = Net MWhY(n) / 1000",
      ],
      footer: "Auxiliary consumption (0.5% of gross) reflects met-mast, SCADA and grid-condition draw. Degradation 0.5%/yr is the standard NIWE / IEC reference for utility-scale wind.",
    },
    {
      section: "2. Revenue (flat tariff)",
      description: "Indian wind PPAs are typically flat — no escalation. Revenue is generation × tariff with a unit conversion to crores.",
      formulas: ["RevenueY(n) [Cr] = Net MWhY(n) × Tariff₹/kWh × 1000 / 10⁷"],
    },
    {
      section: "3. Operating costs & EBITDA",
      description: "O&M is escalated 5%/yr (FSA / AMC norm); insurance is 0.40% of CapEx with 3%/yr escalation.",
      formulas: [
        "O&MY(n) [Cr] = (Capacity × O&ML/MW/yr) / 100 × 1.05^(n−1)",
        "InsuranceY(n) [Cr] = Turnkey × 0.0040 × 1.03^(n−1)",
        "EBITDAY(n) = Revenue − O&M − Insurance",
      ],
    },
    {
      section: "4. CapEx structure (turnkey = WTG + BoP)",
      description: "The model treats turnkey CapEx as the sum of the WTG package and Balance-of-Plant, not WTG alone — which mirrors how Indian wind IPPs actually price projects.",
      formulas: [
        "TurnkeyCr/MW = WTG + BoP (≈ ₹8.5–9.5 Cr/MW)",
        "Total CapExCr = Capacity × Turnkey",
        "DebtCr = Total × Debt%",
        "Equityhard = Total − Debt",
        "Working Capital = RevenueY1 / 12 (one-month cycle)",
        "Equityincl WC = Equityhard + WC",
      ],
    },
    {
      section: "5. Debt service — equated annuity",
      description: "Long-tenor wind-IPP debt is amortised on an equated annual instalment (similar to a mortgage). The fixed annuity is split each year — interest accrues on the outstanding balance, the rest pays down principal.",
      formulas: [
        "Annuity = Debt × r × (1+r)N / [(1+r)N − 1]",
        "InterestY(n) = OutstandingY(n−1) × r",
        "PrincipalY(n) = Annuity − InterestY(n)",
        "OutstandingY(n) = OutstandingY(n−1) − PrincipalY(n)",
        "DSCRY(n) = EBITDAY(n) / Annuity (pre-tax — covenant standard)",
      ],
    },
    {
      section: "6. Depreciation — Sec 32(1) Wind WDV 40%",
      description: "Indian Income-Tax Rules (Block of Assets, Sec 32(1)) prescribe 40% WDV depreciation for wind energy devices post-2017 (cut from 80%). Depreciation is fully exhausted by ~Year 10 — beyond which the project becomes a tax-cash payer.",
      formulas: [
        "DepY(n) = WDVY(n−1) × 0.40",
        "WDVY(n) = WDVY(n−1) − DepY(n)",
        "WDVY0 = Total CapEx",
      ],
    },
    {
      section: "7. Taxation — Sec 115BAA effective 25.168%",
      description: "Most renewable IPPs opt into the concessional Section 115BAA regime — flat 22% rate that grosses up to 25.168% effective with surcharge and cess. MAT does not apply under 115BAA, but accelerated depreciation and most other deductions are forfeited.",
      formulas: [
        "Effective tax = 22% × (1 + 10% surcharge) × (1 + 4% cess) = 25.168%",
        "TaxableunlevY(n) = max(0, EBITDAY(n) − DepY(n))",
        "TaxablelevY(n) = max(0, EBITDAY(n) − DepY(n) − InterestY(n))",
        "TaxY(n) = Taxable × 0.25168",
      ],
    },
    {
      section: "8. Cashflows — unlevered & levered, post-tax",
      description: "Two parallel cashflow streams are built so the verdict shows both project economics (independent of capital structure) and equity returns (after debt service).",
      formulas: [
        "Project CFY(n) = EBITDA − Taxunlev (unlevered, post-tax)",
        "Equity CFY(n) = EBITDA − Annuity − Taxlev (levered, post-tax)",
        "at t = 0: Project CF0 = − Total CapEx − WC",
        "at t = 0: Equity CF0 = − Equityincl WC",
      ],
    },
    {
      section: "9. Year-25 terminal — salvage, cap-gains, WC release",
      description: "Salvage value is taken at 5% of CapEx at year 25 (industry rule of thumb for wind). Capital gains are taxed on the excess of salvage over remaining WDV, and the working capital block is released back to equity.",
      formulas: [
        "Salvage = Total CapEx × 0.05",
        "Cap-gains tax = max(0, Salvage − WDVY25) × 0.25168",
        "Terminal CF = Salvage − Cap-gains tax + WCrecovered",
      ],
    },
    {
      section: "10. NPV & IRR — Newton-Raphson fallback",
      description: "NPV is the standard discounted cashflow sum (with t = 0 not discounted). IRR is solved iteratively, with a guarded numerical method:",
      formulas: [
        "NPV(r, CF) = Σᵢ CF[i] / (1 + r)^i",
        "IRR seed r = 10%; NR: r(k+1) = r(k) − f(r(k)) / f′(r(k))",
        "Project IRR → solved on Project CF stream",
        "Equity IRR → solved on Equity CF stream",
      ],
    },
    {
      section: "11. Bankability decision rule",
      description: "The verdict combines a return test and a coverage test — both must clear. This mirrors how Indian wind IPP debt committees actually screen projects.",
      formulas: [
        "Bankable: post-tax equity IRR ≥ 13% AND avg DSCR ≥ 1.30×",
        "Marginal: post-tax equity IRR ≥ 11% AND avg DSCR ≥ 1.15×",
        "Sub-bankable: fails either threshold",
      ],
    },
  ];

  return (
    <div className="w-full">
      <style>{`
        @keyframes slideDown {
          from {
            opacity: 0;
            transform: translateY(-8px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        .animate-slideDown {
          animation: slideDown 0.3s ease-out;
        }
        .animate-fadeIn {
          animation: fadeIn 0.4s ease-out;
        }
        .methodology-scroll::-webkit-scrollbar {
          width: 6px;
        }
        .methodology-scroll::-webkit-scrollbar-track {
          background: transparent;
        }
        .methodology-scroll::-webkit-scrollbar-thumb {
          background: #334155;
          border-radius: 10px;
        }
        .methodology-scroll::-webkit-scrollbar-thumb:hover {
          background: #f97316;
        }
      `}</style>

      {/* Main Toggle Button */}
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex justify-between items-center px-5 py-4 bg-gradient-to-r from-[#0f1424] to-[#0d1220] border border-[#2a3a54] rounded-lg hover:from-[#141e35] hover:to-[#0f1220] hover:border-orange/50 transition-all duration-300 group shadow-lg"
      >
        <div className="flex items-center gap-3">
          <div className="p-2 bg-orange/10 rounded-lg group-hover:bg-orange/20 transition-colors">
            <svg className="w-5 h-5 text-orange" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
            </svg>
          </div>
          <div className="text-left">
            <h2 className="text-[12px] font-bold text-orange uppercase tracking-wider">Calculation Methodology</h2>
            <p className="text-[10px] text-muted/60 mt-0.5">11 sections • Financial & technical framework</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-[10px] font-medium text-muted/80 group-hover:text-orange transition-colors">
            {open ? "Hide" : "Show"}
          </span>
          <span className={`text-lg text-orange transition-transform duration-300 ${open ? "rotate-180" : ""}`}>▼</span>
        </div>
      </button>

      {/* Expanded Content */}
      {open && (
        <div className="mt-3 animate-slideDown">
          <div className="bg-gradient-to-b from-[#0f1424] via-[#0d1220] to-[#0a0f1c] border border-[#2a3a54] rounded-lg overflow-hidden shadow-2xl">
            <div className="max-h-[700px] overflow-y-auto methodology-scroll">
              <div className="p-6 space-y-4">
                {methodology.map((item, idx) => (
                  <div
                    key={idx}
                    onClick={() => setExpandedSection(expandedSection === idx ? null : idx)}
                    className="group cursor-pointer"
                  >
                    {/* Section Header */}
                    <div className="flex items-start gap-3 p-4 bg-[#0f1424]/50 hover:bg-orange/5 rounded-lg border border-[#1a2a44]/60 hover:border-orange/30 transition-all duration-200">
                      <div className="pt-1">
                        <div className="w-8 h-8 rounded-lg bg-orange/10 flex items-center justify-center text-orange font-bold text-[11px] group-hover:bg-orange/20 transition-colors">
                          {idx + 1}
                        </div>
                      </div>
                      <div className="flex-1 min-w-0">
                        <h3 className="text-[12px] font-bold text-text/90 group-hover:text-orange transition-colors tracking-wide">
                          {item.section}
                        </h3>
                        <p className="text-[11px] text-muted/70 mt-1.5 leading-relaxed">
                          {item.description}
                        </p>
                      </div>
                      <span className={`text-orange text-lg transition-transform duration-200 flex-none ${expandedSection === idx ? "rotate-180" : ""}`}>
                        ▼
                      </span>
                    </div>

                    {/* Expandable Formula Section */}
                    {expandedSection === idx && (
                      <div className="mt-2 animate-slideDown">
                        <div className="ml-4 pl-3 border-l-2 border-orange/30 space-y-2">
                          {item.formulas.map((formula, fIdx) => (
                            <div
                              key={fIdx}
                              className="p-3 bg-[#0a0f1c] border border-[#1a2a44] rounded-lg hover:border-orange/40 transition-all duration-200"
                            >
                              <code className="text-[10px] text-[#ffd0a0] font-mono break-all">
                                {formula}
                              </code>
                            </div>
                          ))}
                          {item.footer && (
                            <div className="mt-3 p-3 bg-orange/5 border border-orange/20 rounded-lg">
                              <p className="text-[10px] text-muted/80 leading-relaxed italic">
                                {item.footer}
                              </p>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                ))}

                {/* Disclaimer Section */}
                <div className="mt-6 p-4 bg-gradient-to-r from-orange/5 to-transparent border border-orange/20 rounded-lg">
                  <h4 className="text-[11px] font-bold text-orange/90 uppercase tracking-wider mb-2">⚠ Disclaimer</h4>
                  <p className="text-[10px] text-muted/70 leading-relaxed">
                    Indicative model — not a bankability certificate. Real bankability is decided by factors this calculator cannot see: 12+ months of validated mast data, terrain & wake suitability, evacuation feasibility, OEM warranty, P50/P75/P90 yield certainty, social licence, land & ROW, and offtaker creditworthiness.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
