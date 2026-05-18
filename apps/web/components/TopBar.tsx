"use client";

import React, { useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { motion, AnimatePresence, Variants } from 'framer-motion';
import AboutModal from './AboutModal';
import EngineModal from './Engines/EngineModal';

type EngineType = 'Finance' | 'Research' | 'Operators';

// Inline icons — line-style, currentColor, so they inherit the surrounding
// text colour and tone with each engine's hover palette.
const FinanceIcon = ({ className = '' }: { className?: string }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.75"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-hidden
  >
    <path d="M3.5 20h17" />
    <path d="M7 20v-5" />
    <path d="M12 20v-9" />
    <path d="M17 20v-7" />
    <path d="M4.5 9.5L9 6.5l4 2 6.5-4.5" />
    <path d="M16 4h3.5V7.5" />
  </svg>
);

const ResearchIcon = ({ className = '' }: { className?: string }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.75"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-hidden
  >
    <circle cx="10.5" cy="10.5" r="6.25" />
    <path d="M10.5 7.5v6" />
    <path d="M7.5 10.5h6" />
    <path d="M15.25 15.25L20 20" />
  </svg>
);

const OperatorsIcon = ({ className = '' }: { className?: string }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.75"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-hidden
  >
    <circle cx="12" cy="12" r="2.75" />
    <path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.1 5.1l2.1 2.1M16.8 16.8l2.1 2.1M5.1 18.9l2.1-2.1M16.8 7.2l2.1-2.1" />
  </svg>
);

const ENGINES: {
  id: EngineType;
  Icon: React.ComponentType<{ className?: string }>;
  desc: string;
}[] = [
  { id: 'Finance',   Icon: FinanceIcon,   desc: 'DCF & Bankability' },
  { id: 'Research',  Icon: ResearchIcon,  desc: 'Resource Intelligence' },
  { id: 'Operators', Icon: OperatorsIcon, desc: 'Fleet & O&M' },
];

// Animation variants
const containerVariants: Variants = {
  hidden: { opacity: 0, y: -20 },
  visible: { 
    opacity: 1, 
    y: 0,
    transition: { 
      duration: 0.6, 
      ease: 'easeOut',
      staggerChildren: 0.1 
    }
  }
};

const itemVariants: Variants = {
  hidden: { opacity: 0, y: -10 },
  visible: { 
    opacity: 1, 
    y: 0,
    transition: { duration: 0.5 }
  }
};

export default function TopBar({
  generatedAt,
  onRefresh,
  isRefreshing,
  showEngines = true,
}: {
  generatedAt?: string;
  onRefresh?: () => void;
  isRefreshing?: boolean;
  /** Hide the Finance / Research / Operators engine cluster (used on the
   *  landing page, where these are previewed in the body of the page). */
  showEngines?: boolean;
}) {
  const [engineOpen, setEngineOpen] = useState<EngineType | null>(null);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [hoveredEngine, setHoveredEngine] = useState<EngineType | null>(null);

  // Engines that aren't yet available — clicking them flashes an inline
  // "coming soon" toast on the same page instead of opening the modal.
  const LOCKED_ENGINES = new Set<EngineType>(['Operators']);
  const [comingSoon, setComingSoon] = useState<EngineType | null>(null);
  const comingSoonTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const flashComingSoon = (engine: EngineType) => {
    if (comingSoonTimer.current) clearTimeout(comingSoonTimer.current);
    setComingSoon(engine);
    comingSoonTimer.current = setTimeout(() => setComingSoon(null), 2400);
  };
  React.useEffect(() => () => {
    if (comingSoonTimer.current) clearTimeout(comingSoonTimer.current);
  }, []);

  return (
    <>
      <motion.header 
        initial="hidden"
        animate="visible"
        variants={containerVariants}
        className="flex-none relative flex items-center justify-between gap-2 px-2.5 sm:px-4 lg:px-6 py-1.5 sm:py-2 lg:py-6 min-h-[52px] lg:h-[68px] overflow-hidden z-30"
        style={{ 
          background: 'linear-gradient(135deg, rgba(6,8,15,0.98) 0%, rgba(12,17,32,0.95) 50%, rgba(10,13,26,0.97) 100%)',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)'
        }}
      >
        {/* Animated gradient borders */}
        <div className="absolute inset-x-0 top-0 h-px">
          <motion.div 
            className="h-full bg-gradient-to-r from-transparent via-orange/60 to-transparent"
            animate={{ 
              backgroundPosition: ['200% 0', '-200% 0'],
            }}
            transition={{ 
              duration: 8, 
              repeat: Infinity,
              ease: 'linear'
            }}
            style={{ backgroundSize: '200% 100%' }}
          />
        </div>
        
        {/* Bottom border */}
        <div className="absolute inset-x-0 bottom-0 h-px">
          <motion.div 
            className="h-full bg-gradient-to-r from-transparent via-white/12 to-transparent"
            animate={{ opacity: [0.5, 1, 0.5] }}
            transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
          />
        </div>

        {/* Ambient glow effects */}
        <motion.div 
          className="absolute left-0 top-0 w-96 h-full bg-orange/5 blur-3xl pointer-events-none"
          animate={{ 
            opacity: [0.3, 0.6, 0.3],
            scale: [1, 1.1, 1]
          }}
          transition={{ duration: 6, repeat: Infinity, ease: 'easeInOut' }}
        />
        <motion.div 
          className="absolute right-0 top-0 w-96 h-full bg-blue-500/3 blur-3xl pointer-events-none"
          animate={{ 
            opacity: [0.2, 0.5, 0.2],
            scale: [1.1, 1, 1.1]
          }}
          transition={{ duration: 8, repeat: Infinity, ease: 'easeInOut' }}
        />

        {/* ── Brand ── */}
        <motion.div variants={itemVariants} className="flex items-center gap-1.5 sm:gap-2 lg:gap-4 z-10 min-w-0 flex-1">
          {/* Logo — clicks return to landing */}
          <Link
            href="/"
            aria-label="Wind Power India — home"
            className="relative w-[56px] h-[60px] sm:w-[60px] sm:h-[64px] lg:w-[65px] lg:h-[70px] flex items-center justify-center overflow-hidden flex-shrink-0 cursor-pointer hover:opacity-90 transition-opacity"
          >
            <Image
              src="/logo.png"
              alt="Wind Power India"
              width={70}
              height={60}
              className="object-contain w-full h-full"
              priority
            />
          </Link>

          {/* Brand text — hidden on mobile; logo alone carries the brand there */}
          <div className="hidden sm:flex flex-col gap-0.5 min-w-0">
            <motion.span
              className="truncate text-[15px] lg:text-[18px] font-black leading-none tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-white via-[#d0e4ff] to-[#ffc87a]"
              animate={{
                backgroundPosition: ['0% 50%', '100% 50%', '0% 50%'],
              }}
              transition={{
                duration: 5,
                repeat: Infinity,
                ease: 'linear'
              }}
              style={{ backgroundSize: '200% 200%' }}
            >
              Wind Power India
            </motion.span>
            <span className="text-[9px] lg:text-[11px] font-medium text-white/35 tracking-[0.08em]">
              Geospatial Wind Intelligence Terminal
            </span>
          </div>

          {/* Live badge with particle effect */}
          {generatedAt && (
            <motion.div 
              initial={{ scale: 0, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: 'spring', stiffness: 300, damping: 20 }}
              className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-full bg-[#0d1f12]/80 border border-[#1a3a20] shadow-[0_0_20px_rgba(76,200,122,0.15)] backdrop-blur-sm"
            >
              <motion.div 
                className="w-2 h-2 rounded-full bg-[#4cc87a]"
                animate={{ 
                  scale: [1, 1.3, 1],
                  boxShadow: [
                    '0 0 6px #4cc87a',
                    '0 0 12px #4cc87a',
                    '0 0 6px #4cc87a'
                  ]
                }}
                transition={{ duration: 2, repeat: Infinity }}
              />
              <span className="text-[11px] font-bold text-[#4cc87a] uppercase tracking-wider">Live</span>
            </motion.div>
          )}
        </motion.div>

        {/* ── Engine buttons + About ── */}
        <motion.div variants={itemVariants} className="flex items-center gap-1.5 lg:gap-3 z-10 flex-shrink-0">
          {/* Engine switcher pill — hidden on landing via `showEngines={false}` */}
          {showEngines && (
          <motion.div
            whileHover={{ scale: 1.02 }}
            className="flex items-center gap-1 sm:gap-1.5 lg:gap-2 p-0.5 sm:p-1 lg:p-1.5 rounded-[16px] sm:rounded-[20px] border border-white/[0.10]"
            style={{
              background: 'rgba(20, 25, 40, 0.5)',
              backdropFilter: 'blur(20px)',
              WebkitBackdropFilter: 'blur(20px)',
              boxShadow: 'inset 0 1px 1px rgba(255,255,255,0.05), 0 4px 20px rgba(0,0,0,0.3)'
            }}
          >
            {ENGINES.map((engine, idx) => {
              // Hover (intense) gradient — same shape as before
              const hoverGradients = [
                'from-blue-500/30 to-cyan-500/15 border-blue-400/55 shadow-[0_0_22px_rgba(59,130,246,0.4)]',
                'from-purple-500/30 to-pink-500/15 border-purple-400/55 shadow-[0_0_22px_rgba(168,85,247,0.4)]',
                'from-emerald-500/30 to-green-500/15 border-emerald-400/55 shadow-[0_0_22px_rgba(16,185,129,0.4)]',
              ];

              // Default (resting) gradient — always visible so the tabs read
              // as obvious interactive features, not subtle ornaments.
              const restGradients = [
                'from-blue-500/18 to-cyan-500/8 border-blue-400/40',
                'from-purple-500/18 to-pink-500/8 border-purple-400/40',
                'from-emerald-500/18 to-green-500/8 border-emerald-400/40',
              ];

              const textColors = [
                'text-blue-100',
                'text-purple-100',
                'text-emerald-100',
              ];

              const iconColors = [
                'text-blue-200',
                'text-purple-200',
                'text-emerald-200',
              ];

              const isHovered = hoveredEngine === engine.id;
              const isLocked  = LOCKED_ENGINES.has(engine.id);

              return (
                <motion.button
                  key={engine.id}
                  onClick={() => {
                    if (isLocked) {
                      flashComingSoon(engine.id);
                    } else {
                      setEngineOpen(engine.id);
                    }
                  }}
                  onHoverStart={() => setHoveredEngine(engine.id)}
                  onHoverEnd={() => setHoveredEngine(null)}
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  className={`group relative flex items-center gap-1.5 sm:gap-1.5 lg:gap-2.5 px-2.5 sm:px-2.5 lg:px-4 py-2 sm:py-1.5 lg:py-2 rounded-2xl border bg-gradient-to-br transition-all duration-300 ${
                    isHovered ? hoverGradients[idx] : restGradients[idx]
                  }`}
                >
                  <motion.span
                    className={`inline-flex items-center justify-center w-[20px] h-[20px] sm:w-[18px] sm:h-[18px] lg:w-[22px] lg:h-[22px] group-hover:scale-110 group-hover:-translate-y-0.5 transition-all duration-300 ${
                      isHovered ? textColors[idx] : iconColors[idx]
                    }`}
                    animate={isHovered ? {
                      rotate: [0, 10, -10, 0],
                      transition: { duration: 0.5 }
                    } : {}}
                  >
                    <engine.Icon className="w-full h-full" />
                  </motion.span>
                  <div className="hidden sm:flex flex-col items-start">
                    <span className={`text-[12.5px] font-bold leading-tight transition-colors duration-300 ${
                      isHovered ? textColors[idx] : iconColors[idx]
                    }`}>
                      {engine.id}
                    </span>
                    <span className="text-[9.5px] text-white/40 leading-tight hidden lg:block font-medium tracking-wide">
                      {engine.desc}
                    </span>
                  </div>

                  {/* Tiny "Soon" badge for locked engines so the lock state
                      reads at a glance — no greying-out, just a clear hint. */}
                  {isLocked && (
                    <span
                      aria-hidden
                      className="ml-0.5 sm:ml-1 px-1.5 py-[1px] rounded
                                 text-[8.5px] sm:text-[8px] font-extrabold uppercase tracking-[0.5px]
                                 bg-orange/85 text-[#0a0e18]
                                 shadow-[0_0_10px_rgba(255,138,31,0.45)]"
                    >
                      Soon
                    </span>
                  )}

                  {/* Animated highlight on hover */}
                  {isHovered && (
                    <motion.div
                      layoutId="engineHighlight"
                      className="absolute inset-0 rounded-2xl opacity-20"
                      style={{
                        background: `radial-gradient(circle at center, transparent 0%, ${
                          idx === 0 ? 'rgba(59,130,246,0.3)' :
                          idx === 1 ? 'rgba(168,85,247,0.3)' :
                          'rgba(16,185,129,0.3)'
                        } 100%)`
                      }}
                      transition={{ type: 'spring', stiffness: 300, damping: 30 }}
                    />
                  )}
                </motion.button>
              );
            })}
          </motion.div>
          )}

          {/* Divider — only meaningful when the engine pill is visible */}
          {showEngines && (
          <motion.div
            initial={{ scaleY: 0 }}
            animate={{ scaleY: 1 }}
            transition={{ delay: 0.5 }}
            className="hidden sm:block w-px h-8 bg-white/10"
          />
          )}

          {/* About button — clean SaaS: solid weight, restrained accent,
              one quiet hover sweep. Bigger and brighter than the prior
              pass without going back to the shiny look. */}
          <motion.button
            onClick={() => setAboutOpen(true)}
            whileTap={{ scale: 0.97 }}
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4, duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
            aria-label="About"
            className="group relative flex items-center gap-0 sm:gap-2
                       p-2 sm:p-0 sm:px-4 lg:px-5 sm:py-2.5 lg:py-3 rounded-lg
                       text-[11.5px] sm:text-[12.5px] lg:text-[13.5px] font-semibold tracking-tight
                       text-white hover:text-white
                       border border-white/15 hover:border-white/30
                       bg-white/[0.06] hover:bg-white/[0.10]
                       shadow-[inset_0_1px_0_rgba(255,255,255,0.06),0_1px_0_rgba(0,0,0,0.35)]
                       transition-colors duration-200 overflow-hidden
                       focus:outline-none focus-visible:ring-2 focus-visible:ring-white/25"
          >
            {/* Info icon with a soft orange wash on hover for personality */}
            <svg
              width="16" height="16" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="2"
              strokeLinecap="round" strokeLinejoin="round"
              className="sm:w-[15px] sm:h-[15px] text-white/70 group-hover:text-orange-200 transition-colors duration-200"
            >
              <circle cx="12" cy="12" r="9" />
              <path d="M12 11v5" />
              <circle cx="12" cy="7.5" r="0.6" fill="currentColor" />
            </svg>

            <span className="relative hidden sm:inline">About</span>

            {/* Single light sweep — runs ONCE on hover, then resets.
                No continuous animation. */}
            <span
              aria-hidden
              className="pointer-events-none absolute inset-y-0 -left-1/3 w-1/3
                         bg-gradient-to-r from-transparent via-white/[0.12] to-transparent
                         -translate-x-full opacity-0
                         group-hover:opacity-100 group-hover:translate-x-[420%]
                         transition-[transform,opacity] duration-[800ms] ease-out"
            />
          </motion.button>
          {/* Refresh button — hidden on mobile to keep the bar uncluttered */}
          {onRefresh && (
            <motion.button
              onClick={onRefresh}
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.7, type: 'spring' }}
              className="relative hidden sm:flex items-center justify-center w-8 h-8 lg:w-10 lg:h-10 rounded-xl bg-white/[0.03] border border-white/10 text-white/50 hover:text-white hover:bg-white/10 transition-colors shadow-sm"
              disabled={isRefreshing}
            >
              <motion.svg 
                xmlns="http://www.w3.org/2000/svg" 
                viewBox="0 0 24 24" 
                fill="none" 
                stroke="currentColor" 
                strokeWidth="2" 
                strokeLinecap="round" 
                strokeLinejoin="round" 
                className="w-4 h-4"
                animate={isRefreshing ? { rotate: 360 } : { rotate: 0 }}
                transition={isRefreshing ? { repeat: Infinity, duration: 1, ease: "linear" } : {}}
              >
                <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                <path d="M3 3v5h5" />
              </motion.svg>
            </motion.button>
          )}
        </motion.div>
      </motion.header>

      {/* Inline "coming soon" toast — anchored under the topbar, doesn't
          open a new modal/terminal. */}
      <AnimatePresence>
        {comingSoon && (
          <motion.div
            key="engine-coming-soon"
            initial={{ opacity: 0, y: -8, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.97 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            className="fixed top-[60px] sm:top-[68px] left-1/2 -translate-x-1/2 z-40
                       flex items-center gap-2.5 px-3.5 py-2 rounded-xl
                       bg-[#0a0e18]/95 backdrop-blur-xl
                       border border-orange/35
                       shadow-[0_12px_28px_-10px_rgba(0,0,0,0.7)]"
          >
            <span className="text-[9px] font-semibold uppercase tracking-[0.14em]
                             px-1.5 py-0.5 rounded bg-orange text-[#0a0e18]">
              {comingSoon}
            </span>
            <span className="text-[12px] font-medium text-white/90">
              Engine · coming soon
            </span>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {engineOpen && (
          <EngineModal 
            initialEngine={engineOpen} 
            onClose={() => setEngineOpen(null)} 
          />
        )}
        {aboutOpen && (
          <AboutModal onClose={() => setAboutOpen(false)} />
        )}
      </AnimatePresence>
    </>
  );
}