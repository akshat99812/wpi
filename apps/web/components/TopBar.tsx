"use client";

import React, { useState, useRef, useEffect } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence, Variants } from 'framer-motion';
import AboutModal from './AboutModal';
import PageSwitcher from './PageSwitcher';
import { useSession, signOut } from '@/lib/auth-client';

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
  showAbout = true,
  windPotentialGw,
}: {
  generatedAt?: string;
  onRefresh?: () => void;
  isRefreshing?: boolean;
  /** Hide the page-switcher pill (used on the landing page, where the
   *  three portal sections are previewed in the body of the page). */
  showEngines?: boolean;
  /** Hide the About button (used on the landing page). */
  showAbout?: boolean;
  /** All-India onshore wind potential at 150 m (GW), from the live niwe
   *  crawler. Forwarded to AboutModal so its headline figure stays in
   *  sync with the bundle. Falls back to 1163.9 when undefined (e.g.
   *  landing page, no bundle fetched). */
  windPotentialGw?: number;
}) {
  const [aboutOpen, setAboutOpen] = useState(false);

  return (
    <>
      <motion.header
        initial="hidden"
        animate="visible"
        variants={containerVariants}
        className="flex-none relative flex items-center justify-between gap-2 px-2.5 sm:px-4 lg:px-6 py-1.5 sm:py-2 lg:py-6 min-h-[52px] lg:h-[68px] z-30"
        style={{
          background: 'linear-gradient(135deg, rgba(6,8,15,0.98) 0%, rgba(12,17,32,0.95) 50%, rgba(10,13,26,0.97) 100%)',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)'
        }}
      >
        {/* Decorative layer — borders + ambient glows. Wrapped in its own
            overflow-hidden box so the glow blur stays contained without
            clipping the auth-menu dropdown that hangs below the header. */}
        <div aria-hidden className="absolute inset-0 overflow-hidden pointer-events-none">
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
            className="absolute left-0 top-0 w-96 h-full bg-orange/5 blur-3xl"
            animate={{
              opacity: [0.3, 0.6, 0.3],
              scale: [1, 1.1, 1]
            }}
            transition={{ duration: 6, repeat: Infinity, ease: 'easeInOut' }}
          />
          <motion.div
            className="absolute right-0 top-0 w-96 h-full bg-blue-500/3 blur-3xl"
            animate={{
              opacity: [0.2, 0.5, 0.2],
              scale: [1.1, 1, 1.1]
            }}
            transition={{ duration: 8, repeat: Infinity, ease: 'easeInOut' }}
          />
        </div>

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

        {/* ── Page switcher + About ── */}
        <motion.div variants={itemVariants} className="flex items-center gap-1.5 lg:gap-3 z-10 flex-shrink-0">
          {/* Three-tab page switcher (Geospatial / Finance / Research).
              Hidden on landing via `showEngines={false}`. */}
          {showEngines && <PageSwitcher />}

          {/* Divider — only meaningful when the page switcher is visible */}
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
          {showAbout && (
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
          )}
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

          {/* Auth controls — login/signup or user menu */}
          <AuthControls />
        </motion.div>
      </motion.header>

      <AnimatePresence>
        {aboutOpen && (
          <AboutModal onClose={() => setAboutOpen(false)} potentialGw={windPotentialGw} />
        )}
      </AnimatePresence>
    </>
  );
}

function AuthControls() {
  const { data: session, isPending } = useSession();
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  // Avoid a flash of "Log in / Sign up" while the session is still loading.
  if (isPending) return <div className="w-[120px] h-8" aria-hidden />;

  if (!session?.user) {
    return (
      <motion.div
        initial={{ opacity: 0, x: 20 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ delay: 0.55, type: 'spring' }}
        className="flex items-center gap-1.5 lg:gap-2"
      >
        <Link
          href="/login"
          className="px-3 lg:px-4 py-2 lg:py-2.5 rounded-lg text-[12px] lg:text-[12.5px] font-semibold tracking-tight text-white/85 hover:text-white border border-white/15 hover:border-white/30 bg-white/[0.04] hover:bg-white/[0.08] transition-colors"
        >
          Log in
        </Link>
        <Link
          href="/signup"
          className="px-3 lg:px-4 py-2 lg:py-2.5 rounded-lg text-[12px] lg:text-[12.5px] font-semibold tracking-tight text-[#07090f] bg-orange hover:bg-orange/90 transition-colors shadow-[0_1px_0_rgba(0,0,0,0.35),inset_0_1px_0_rgba(255,255,255,0.18)]"
        >
          Sign up
        </Link>
      </motion.div>
    );
  }

  const user = session.user;
  const displayName = user.name?.split(' ')[0] || user.email.split('@')[0];
  const initial = (user.name || user.email)[0]?.toUpperCase() ?? '?';
  const tier = (user as { tier?: string }).tier ?? 'FREE';

  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: 0.55, type: 'spring' }}
      className="relative"
      ref={menuRef}
    >
      <button
        onClick={() => setMenuOpen(v => !v)}
        className="flex items-center gap-2 pl-1.5 pr-2.5 py-1.5 rounded-lg border border-white/15 hover:border-white/30 bg-white/[0.04] hover:bg-white/[0.08] transition-colors"
      >
        <div className="w-6 h-6 rounded-md bg-orange/25 flex items-center justify-center text-[11px] font-bold text-orange">
          {initial}
        </div>
        <span className="text-[12px] font-semibold text-white/90 hidden sm:block max-w-[90px] truncate">
          {displayName}
        </span>
        {tier === 'PREMIUM' && (
          <span className="text-[9px] px-1.5 py-0.5 bg-orange/20 text-orange border border-orange/30 rounded font-bold uppercase tracking-wide">
            Pro
          </span>
        )}
      </button>

      <AnimatePresence>
        {menuOpen && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.12 }}
            className="absolute right-0 top-[calc(100%+8px)] z-50 w-56 bg-[#0d1628] border border-[#1e2c44] rounded-xl shadow-2xl p-1.5 flex flex-col gap-0.5"
          >
            <div className="px-2.5 py-2 border-b border-[#1e2c44] mb-1">
              <p className="text-[12px] font-bold text-white truncate">{user.name || displayName}</p>
              <p className="text-[10px] text-white/55 truncate">{user.email}</p>
              <p className="text-[9px] text-orange mt-1 font-bold uppercase tracking-wide">
                {tier} plan
              </p>
            </div>
            <button
              onClick={async () => {
                setMenuOpen(false);
                await signOut();
                router.push('/');
                router.refresh();
              }}
              className="w-full text-left text-[11px] px-2.5 py-2 rounded-lg text-white/70 hover:text-white hover:bg-white/5 transition-colors"
            >
              Sign out
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}