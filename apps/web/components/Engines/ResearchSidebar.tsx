"use client";

/**
 * Research sub-navigation sidebar.
 *
 * The Research section is split into three focused sub-routes:
 *   - /research/chatbot  → Pro RAG chatbot over 25 yrs of wind directories
 *   - /research          → Intelligence (resource dashboard + AI topic search)
 *   - /research/policy    → Wind Policy Comparison (Pro)
 *
 * This sidebar lets the user move between them. It mirrors FinanceSidebar's
 * visual language: a glassy surface with an orange gradient "active" pill that
 * slides between items via a shared framer-motion layoutId.
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

const ChatbotIcon = ({ className = '' }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
       strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"
       className={className} aria-hidden>
    <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
  </svg>
);

const IntelligenceIcon = ({ className = '' }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
       strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"
       className={className} aria-hidden>
    <circle cx="10.5" cy="10.5" r="6.25" />
    <path d="M10.5 7.5v6" />
    <path d="M7.5 10.5h6" />
    <path d="M15.25 15.25L20 20" />
  </svg>
);

const PolicyIcon = ({ className = '' }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
       strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"
       className={className} aria-hidden>
    <path d="M12 3v18" />
    <path d="M5 7l-2 5a3 3 0 0 0 6 0l-2-5z" />
    <path d="M19 7l-2 5a3 3 0 0 0 6 0l-2-5z" />
    <path d="M5 7h14" />
    <path d="M8 21h8" />
  </svg>
);

const ITEMS: NavItem[] = [
  { href: '/research/chatbot', label: 'Chatbot',      desc: 'RAG · 25-yr archive',        Icon: ChatbotIcon      },
  { href: '/research',         label: 'Intelligence', desc: 'Resource · AI Topic Search', Icon: IntelligenceIcon },
  { href: '/research/policy',  label: 'Policy',       desc: 'Jurisdiction comparison',    Icon: PolicyIcon       },
];

// Intelligence is the default and lives at /research, so a naive prefix match
// would light it up on the sub-routes too. Resolve to the single most-specific
// (longest) match.
function activeHref(pathname: string | null): string {
  if (pathname?.startsWith('/research/chatbot')) return '/research/chatbot';
  if (pathname?.startsWith('/research/policy'))  return '/research/policy';
  return '/research';
}

export default function ResearchSidebar() {
  const pathname = usePathname();
  const activeId = activeHref(pathname);

  return (
    <nav
      aria-label="Research sections"
      className="shrink-0 flex lg:flex-col gap-1.5 overflow-x-auto custom-scrollbar
                 border-b lg:border-b-0 lg:border-r border-[#1f2740] bg-[#0a0e18]
                 p-2.5 sm:p-3 lg:w-60 lg:p-4"
    >
      {/* Eyebrow — desktop only */}
      <div className="hidden lg:flex items-center gap-2 px-1 mb-2
                      text-[10px] tracking-[1.1px] text-orange uppercase font-bold">
        <div className="w-3.5 h-[2px] rounded bg-gradient-to-r from-orange to-transparent" />
        Research Suite
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
                layoutId="research-sidebar-active-pill"
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
