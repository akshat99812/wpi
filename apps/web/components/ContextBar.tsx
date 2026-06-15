"use client";

import React, { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useSession, signOut } from '@/lib/auth-client';
import type { WpiBundle } from '@/lib/types';
import type { BasemapId } from './Map/types';
import { NumberTicker } from '@/registry/magicui/number-ticker';

const MODE_LABELS: Record<BasemapId, string> = {
  satellite: 'Satellite',
  terrain:   'Terrain',
  wind:      'Wind',
  windflow:  'Wind flow',
  street:    'Street',
  pro:       'Pro',
};

interface Props {
  bundle?:        WpiBundle | null;
  basemap:        BasemapId;
}

export default function ContextBar({ bundle, basemap }: Props) {
  const { data: session } = useSession();
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

  const ss    = bundle?.sourceStatus ?? {};
  const ok    = Object.values(ss).filter(s => s.ok).length;
  const total = Object.keys(ss).length || 15;
  const allOk = ok === total;
  const marginal = ok >= Math.ceil(total * 0.8);

  let ageLabel = 'No data';
  if (bundle?.generatedAt) {
    const mins = Math.floor((Date.now() - new Date(bundle.generatedAt).getTime()) / 60000);
    ageLabel = mins < 60 ? `${mins}m ago` : `${Math.floor(mins / 60)}h ago`;
  }

  return (
    <div className="flex-none px-4 py-1.5 bg-[#07090f]/90 backdrop-blur-sm border-b border-white/5 flex items-center gap-3 overflow-x-auto no-scrollbar">

      {/* Source health */}
      <div className={`flex items-center gap-1.5 px-2.5 py-[5px] rounded-full border text-[10px] font-bold shrink-0 ${
        allOk ? 'bg-[#0d1c10]/80 border-[#1d3020]/60 text-[#4cc87a]'
        : marginal ? 'bg-[#1a1408]/80 border-[#2e2010]/60 text-[#ffb066]'
        : 'bg-[#1c0d0d]/80 border-[#3a1515]/60 text-[#e85c5c]'
      }`}>
        <div className={`w-1.5 h-1.5 rounded-full ${allOk ? 'bg-[#4cc87a]' : marginal ? 'bg-[#ffb066]' : 'bg-[#e85c5c]'}`} />
        <span suppressHydrationWarning className="flex items-center gap-0.5">
          <NumberTicker value={ok} className="tabular-nums" />
          <span className="opacity-70">/</span>
          <NumberTicker value={total} className="tabular-nums" />
          <span className="ml-1">sources</span>
        </span>
      </div>

      {/* Data age */}
      <div className="flex items-center gap-1.5 px-2.5 py-[5px] rounded-full border border-[#1e2c44] bg-[#0d1628]/80 text-[10px] font-bold text-muted shrink-0">
        <span>⏱</span>
        <span suppressHydrationWarning>{ageLabel}</span>
      </div>

      <div className="w-px h-4 bg-white/10 shrink-0" />

      {/* Active basemap badge (read-only — switcher is on the map) */}
      <div className="flex items-center gap-1.5 px-2.5 py-[5px] rounded-full border border-[#1e2c44] bg-[#0d1628]/80 text-[10px] font-bold text-muted shrink-0">
        <span className="text-[9px] uppercase tracking-[0.14em] text-muted/55">Basemap</span>
        <span>{MODE_LABELS[basemap]}</span>
      </div>

      <div className="flex-1 min-w-0" />

      {bundle?.generatedAt && (
        <span suppressHydrationWarning className="text-[9px] text-white/20 shrink-0 hidden lg:block">
          {new Date(bundle.generatedAt).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
        </span>
      )}

      <div className="w-px h-4 bg-white/10 shrink-0" />

      {/* Auth */}
      {session?.user ? (
        // ── Signed-in user menu ────────────────────────────────────────────
        <div className="relative shrink-0" ref={menuRef}>
          <button
            onClick={() => setMenuOpen(v => !v)}
            className="flex items-center gap-1.5 px-2 py-1 rounded-full border border-[#1e2c44] bg-[#0d1628]/80 hover:border-orange/40 transition-colors"
          >
            <div className="w-[18px] h-[18px] rounded-full bg-orange/30 flex items-center justify-center text-[9px] font-bold text-orange">
              {(session.user.name || session.user.email)[0]?.toUpperCase() ?? '?'}
            </div>
            <span className="text-[10px] font-bold text-text hidden sm:block max-w-[80px] truncate">
              {session.user.name?.split(' ')[0] ?? session.user.email.split('@')[0]}
            </span>
            {session.user.tier === 'PREMIUM' && (
              <span className="text-[8px] px-1 py-0.5 bg-orange/20 text-orange border border-orange/30 rounded font-bold uppercase">Pro</span>
            )}
          </button>

          {menuOpen && (
            <div className="absolute right-0 top-[calc(100%+6px)] z-50 w-44 bg-[#0d1628] border border-[#1e2c44] rounded-xl shadow-2xl p-1.5 flex flex-col gap-0.5">
              <div className="px-2 py-1.5 border-b border-[#1e2c44] mb-1">
                <p className="text-[11px] font-bold text-text truncate">{session.user.name || session.user.email.split('@')[0]}</p>
                <p className="text-[9px] text-muted/60 truncate">{session.user.email}</p>
                <p className="text-[9px] text-orange mt-0.5 font-bold uppercase tracking-wide">
                  {session.user.tier ?? 'FREE'} plan
                </p>
              </div>
              <button
                onClick={async () => {
                  setMenuOpen(false);
                  await signOut();
                  router.push('/');
                  router.refresh();
                }}
                className="w-full text-left text-[10px] px-2.5 py-1.5 rounded-lg text-muted/70 hover:text-text hover:bg-white/5 transition-colors"
              >
                Sign out
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="flex items-center gap-1.5 shrink-0">
          <Link
            href="/login"
            className="px-3 py-[5px] rounded-full border border-[#1e2c44] bg-[#0d1628]/80 text-[10px] font-bold text-text hover:border-orange/40 transition-colors"
          >
            Log in
          </Link>
          <Link
            href="/signup"
            className="px-3 py-[5px] rounded-full border border-orange/30 bg-orange/10 text-[10px] font-bold text-orange hover:bg-orange/20 hover:border-orange/50 transition-colors"
          >
            Sign up
          </Link>
        </div>
      )}
    </div>
  );
}
