"use client";

import React, { useState, useRef, useEffect } from 'react';
import { useSession, signIn, signOut } from 'next-auth/react';
import Image from 'next/image';
import type { WpiBundle } from '@/lib/types';
import type { BasemapId } from './Map/types';
import { NumberTicker } from '@/registry/magicui/number-ticker';

const MODE_LABELS: Record<BasemapId, string> = {
  satellite: 'Satellite',
  terrain:   'Terrain',
  wind:      'Wind',
  street:    'Street',
  pro:       'Pro',
};

interface Props {
  bundle?:        WpiBundle | null;
  basemap:        BasemapId;
}

export default function ContextBar({ bundle, basemap }: Props) {
  const { data: session } = useSession();
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
            {session.user.image ? (
              <Image src={session.user.image} alt="" width={18} height={18} className="rounded-full" />
            ) : (
              <div className="w-[18px] h-[18px] rounded-full bg-orange/30 flex items-center justify-center text-[9px] font-bold text-orange">
                {session.user.name?.[0]?.toUpperCase() ?? '?'}
              </div>
            )}
            <span className="text-[10px] font-bold text-text hidden sm:block max-w-[80px] truncate">
              {session.user.name?.split(' ')[0] ?? 'Account'}
            </span>
            {session.user.tier === 'PREMIUM' && (
              <span className="text-[8px] px-1 py-0.5 bg-orange/20 text-orange border border-orange/30 rounded font-bold uppercase">Pro</span>
            )}
          </button>

          {menuOpen && (
            <div className="absolute right-0 top-[calc(100%+6px)] z-50 w-44 bg-[#0d1628] border border-[#1e2c44] rounded-xl shadow-2xl p-1.5 flex flex-col gap-0.5">
              <div className="px-2 py-1.5 border-b border-[#1e2c44] mb-1">
                <p className="text-[11px] font-bold text-text truncate">{session.user.name}</p>
                <p className="text-[9px] text-muted/60 truncate">{session.user.email}</p>
                <p className="text-[9px] text-orange mt-0.5 font-bold uppercase tracking-wide">
                  {session.user.tier ?? 'FREE'} plan
                </p>
              </div>
              <button
                onClick={() => { setMenuOpen(false); signOut(); }}
                className="w-full text-left text-[10px] px-2.5 py-1.5 rounded-lg text-muted/70 hover:text-text hover:bg-white/5 transition-colors"
              >
                Sign out
              </button>
            </div>
          )}
        </div>
      ) : process.env.NEXT_PUBLIC_AUTH_ENABLED === 'true' ? (
        <button
          onClick={() => signIn('google')}
          className="shrink-0 flex items-center gap-1.5 px-3 py-[5px] rounded-full border border-orange/30 bg-orange/10 text-[10px] font-bold text-orange hover:bg-orange/20 hover:border-orange/50 transition-colors"
        >
          <GoogleIcon />
          Sign in
        </button>
      ) : null}
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
    </svg>
  );
}
