"use client";

/**
 * Finance sub-navigation sidebar.
 *
 * The Finance section was split out of a single cramped two-pane page into
 * two focused sub-routes:
 *   - /finance/dashboard   → market benchmarks (tariffs, CapEx, debt, tax…)
 *   - /finance/calculator  → 25-yr DCF bankability calculator
 *
 * This sidebar lets the user move between them. It mirrors the TopBar
 * PageSwitcher's visual language: a glassy surface with an orange gradient
 * "active" pill that slides between items via a shared framer-motion layoutId.
 *
 * Layout: a vertical rail on desktop (lg+), a horizontal tab row on mobile.
 */
import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { motion } from 'framer-motion';

interface NavItem {
  href:  string;
  label: string;
  desc:  string;
  Icon:  React.ComponentType<{ className?: string }>;
}

// Shared active-tab palette — same orange used by the TopBar PageSwitcher.
const ACTIVE = {
  from:   '#ff9a3c',
  to:     '#ff7a1f',
  text:   '#0a0e18',
  shadow: 'rgba(255,138,31,0.45)',
};

const BenchmarksIcon = ({ className = '' }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
       strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"
       className={className} aria-hidden>
    <path d="M3.5 20h17" />
    <path d="M7 20v-5" />
    <path d="M12 20v-9" />
    <path d="M17 20v-7" />
    <path d="M4.5 9.5L9 6.5l4 2 6.5-4.5" />
    <path d="M16 4h3.5V7.5" />
  </svg>
);

const CalculatorIcon = ({ className = '' }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
       strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"
       className={className} aria-hidden>
    <rect x="5" y="3" width="14" height="18" rx="2" />
    <path d="M8 7h8" />
    <path d="M8 11h0M12 11h0M16 11h0M8 14.5h0M12 14.5h0M16 14.5h0M8 18h0M12 18h0M16 18h0" />
  </svg>
);

const ITEMS: NavItem[] = [
  { href: '/finance',            label: 'Calculator', desc: '25-yr DCF · IRR · DSCR',        Icon: CalculatorIcon },
  { href: '/finance/benchmarks', label: 'Benchmarks', desc: 'Tariffs · CapEx · Debt · Tax', Icon: BenchmarksIcon },
];

// The Calculator is the default and lives at /finance, so a naive prefix match
// would light it up on /finance/benchmarks too. Resolve to the single
// most-specific (longest) match.
function activeHref(pathname: string | null): string {
  if (pathname?.startsWith('/finance/benchmarks')) return '/finance/benchmarks';
  return '/finance';
}

export default function FinanceSidebar() {
  const pathname = usePathname();
  const activeId = activeHref(pathname);

  return (
    <nav
      aria-label="Finance sections"
      className="shrink-0 flex lg:flex-col gap-1.5 overflow-x-auto custom-scrollbar
                 border-b lg:border-b-0 lg:border-r border-[#1f2740] bg-[#0a0e18]
                 p-2.5 sm:p-3 lg:w-60 lg:p-4"
    >
      {/* Eyebrow — desktop only */}
      <div className="hidden lg:flex items-center gap-2 px-1 mb-2
                      text-[10px] tracking-[1.1px] text-orange uppercase font-bold">
        <div className="w-3.5 h-[2px] rounded bg-gradient-to-r from-orange to-transparent" />
        Finance Suite
      </div>

      {ITEMS.map(item => {
        const active = activeId === item.href;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className="group relative flex-1 lg:flex-none outline-none"
          >
            {/* Animated active pill — slides between items via shared layoutId */}
            {active && (
              <motion.span
                layoutId="finance-sidebar-active-pill"
                className="absolute inset-0 rounded-xl"
                style={{
                  background: `linear-gradient(135deg, ${ACTIVE.from} 0%, ${ACTIVE.to} 100%)`,
                  boxShadow:
                    `0 0 18px ${ACTIVE.shadow}, inset 0 1px 0 rgba(255,255,255,0.30), inset 0 -1px 0 rgba(0,0,0,0.18)`,
                }}
                transition={{ type: 'spring', stiffness: 420, damping: 34, mass: 0.7 }}
              />
            )}

            {/* Soft hover wash on inactive items */}
            {!active && (
              <span
                aria-hidden
                className="absolute inset-0 rounded-xl transition-colors duration-200
                           border border-transparent bg-white/0
                           group-hover:bg-white/[0.05] group-hover:border-white/[0.06]"
              />
            )}

            <span
              className={`relative z-10 flex items-center gap-2.5
                          px-3 py-2 lg:py-2.5 rounded-xl whitespace-nowrap
                          transition-colors duration-200
                          ${active ? '' : 'text-white/60 group-hover:text-white'}`}
              style={active ? { color: ACTIVE.text } : undefined}
            >
              <item.Icon className="w-[17px] h-[17px] shrink-0" />
              <span className="flex flex-col leading-tight min-w-0">
                <span className="text-[12px] font-bold">{item.label}</span>
                <span
                  className={`hidden lg:block text-[9.5px] font-medium tracking-tight
                              ${active ? 'opacity-70' : 'opacity-50'}`}
                >
                  {item.desc}
                </span>
              </span>
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
