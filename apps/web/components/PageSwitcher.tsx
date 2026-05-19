"use client";

/**
 * Three-tab page switcher used in the TopBar across the portal pages
 * (Geospatial / Finance / Research). Visual treatment mirrors the
 * map's BasemapSwitcher: a glassy pill, per-tab accent gradient, and a
 * shared layoutId pill that slides between tabs when the route
 * changes.
 */
import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { motion } from 'framer-motion';

type PageId = 'geospatial' | 'finance' | 'research';

interface PageDef {
  id:     PageId;
  href:   string;
  label:  string;
  desc:   string;
  Icon:   React.ComponentType<{ className?: string }>;
}

// Shared active-tab palette — same orange box on all three tabs so the
// switch reads as "you are on this page", not "this page is themed X".
const ACTIVE = {
  from:   '#ff9a3c',
  to:     '#ff7a1f',
  text:   '#0a0e18',
  shadow: 'rgba(255,138,31,0.55)',
};

const GeospatialIcon = ({ className = '' }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
       strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"
       className={className} aria-hidden>
    <path d="M3 6.5l6-2 6 2 6-2v13l-6 2-6-2-6 2v-13z" />
    <path d="M9 4.5v13M15 6.5v13" />
  </svg>
);

const FinanceIcon = ({ className = '' }: { className?: string }) => (
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

const ResearchIcon = ({ className = '' }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
       strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"
       className={className} aria-hidden>
    <circle cx="10.5" cy="10.5" r="6.25" />
    <path d="M10.5 7.5v6" />
    <path d="M7.5 10.5h6" />
    <path d="M15.25 15.25L20 20" />
  </svg>
);

const PAGES: PageDef[] = [
  { id: 'geospatial', href: '/geospatial', label: 'Geospatial', desc: 'Map · State Deep Dive', Icon: GeospatialIcon },
  { id: 'finance',    href: '/finance',    label: 'Finance',    desc: 'DCF & Bankability',    Icon: FinanceIcon    },
  { id: 'research',   href: '/research',   label: 'Research',   desc: 'Resource Intelligence', Icon: ResearchIcon  },
];

function activeIdFor(pathname: string | null): PageId {
  if (!pathname) return 'geospatial';
  if (pathname.startsWith('/finance'))   return 'finance';
  if (pathname.startsWith('/research'))  return 'research';
  // /geospatial AND the legacy /dashboard route both map to Geospatial.
  return 'geospatial';
}

export default function PageSwitcher() {
  const pathname = usePathname();
  const activeId = activeIdFor(pathname);

  return (
    <motion.div
      initial={{ opacity: 0, y: -8, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
      className="relative flex items-center gap-1 rounded-2xl px-1.5 py-1.5
                 backdrop-blur-2xl backdrop-saturate-150 overflow-hidden
                 bg-[#0a0e18]/85 border border-white/15
                 shadow-[0_8px_32px_-8px_rgba(0,0,0,0.7),inset_0_1px_0_rgba(255,255,255,0.10),inset_0_-1px_0_rgba(0,0,0,0.3)]"
    >
      {/* Specular highlight */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 rounded-2xl opacity-60"
        style={{
          background:
            'linear-gradient(135deg, rgba(255,255,255,0.10) 0%, rgba(255,255,255,0.02) 35%, rgba(255,255,255,0) 60%)',
        }}
      />
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 rounded-2xl"
        style={{
          background:
            'radial-gradient(120% 80% at 50% 0%, rgba(255,255,255,0.08), transparent 60%)',
        }}
      />

      {PAGES.map(p => {
        const isActive = activeId === p.id;
        return (
          <Link
            key={p.id}
            href={p.href}
            aria-current={isActive ? 'page' : undefined}
            className="relative z-10"
          >
            <motion.span
              whileHover={isActive ? undefined : { y: -1 }}
              whileTap={{ scale: 0.94 }}
              transition={{ type: 'spring', stiffness: 380, damping: 26 }}
              className={`group relative flex items-center gap-1.5 sm:gap-2 px-2.5 sm:px-3 lg:px-3.5 py-1.5 lg:py-2 rounded-xl
                          text-[10.5px] sm:text-[11.5px] font-bold whitespace-nowrap outline-none
                          transition-colors duration-200
                          ${isActive ? '' : 'text-white/65 hover:text-white'}`}
              style={isActive ? { color: ACTIVE.text } : undefined}
            >
              {/* Animated active pill — slides between tabs via shared layoutId */}
              {isActive && (
                <motion.span
                  layoutId="page-switcher-active-pill"
                  className="absolute inset-0 rounded-xl"
                  style={{
                    background: `linear-gradient(135deg, ${ACTIVE.from} 0%, ${ACTIVE.to} 100%)`,
                    boxShadow:
                      `0 0 18px ${ACTIVE.shadow}, inset 0 1px 0 rgba(255,255,255,0.35), inset 0 -1px 0 rgba(0,0,0,0.18)`,
                  }}
                  transition={{ type: 'spring', stiffness: 420, damping: 34, mass: 0.7 }}
                />
              )}

              {/* Soft hover wash on inactive tabs */}
              {!isActive && (
                <span
                  aria-hidden
                  className="absolute inset-0 rounded-xl transition-colors duration-200
                             bg-white/0 group-hover:bg-white/[0.08]"
                />
              )}

              <span className="relative flex items-center gap-1.5 sm:gap-2">
                <p.Icon className="w-[14px] h-[14px] sm:w-[15px] sm:h-[15px]" />
                <span className="hidden sm:inline leading-none">{p.label}</span>
              </span>
            </motion.span>
          </Link>
        );
      })}
    </motion.div>
  );
}
