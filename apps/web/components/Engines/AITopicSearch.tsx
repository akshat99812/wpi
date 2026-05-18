"use client";

import React from 'react';

// ── Sample chat thread shown as a *preview* behind the lock overlay.
//    These messages never get sent — they exist purely to communicate the
//    chatbot's tone, breadth, and depth-of-answer to free-tier users.
type ChatMessage = { role: 'user' | 'bot'; text: string; pills?: string[] };
const SAMPLE_THREAD: ChatMessage[] = [
  {
    role: 'user',
    text: 'What\'s India\'s offshore wind potential and FY30 target?',
  },
  {
    role: 'bot',
    text: 'MNRE pegs total offshore potential at ~70 GW — Gujarat ~36 GW, Tamil Nadu ~34 GW. The 2024 strategy targets 37 GW by FY30, anchored in the Gulf of Kutch and the Dhanushkodi / Gulf of Mannar zone, supported by a ₹7,500 cr VGF envelope.',
    pills: ['MNRE 2024', 'NIWE LiDAR'],
  },
  {
    role: 'user',
    text: 'Latest FDRE clearing prices?',
  },
  {
    role: 'bot',
    text: 'FDRE-II cleared at ₹4.45/kWh (RTC), FDRE-III at ₹4.65/kWh. The wind allocation in FDRE rounds is typically 50-60% with 2-4 hr BESS firming. SECI FDRE-VII is open with bid due Jan 2026.',
    pills: ['SECI FDRE', '₹4.45–4.65/kWh'],
  },
  {
    role: 'user',
    text: 'Which states are best for repowering?',
  },
];

const TRAINING_BADGES = [
  'CECL proprietary archive',
  'MNRE · NIWE · CEA',
  'SECI · CERC · SERCs',
  'PIB · MoP · State nodal',
];

export default function AITopicSearch() {
  return (
    <div className="relative flex flex-col h-full min-h-[460px] sm:min-h-[500px] gap-3 sm:gap-4 isolate">
      {/* ── Local animation keyframes ───────────────────────────────── */}
      <style>{`
        @keyframes rc-orb-a { 0%,100%{transform:translate3d(0,0,0) scale(1);} 50%{transform:translate3d(8%,-6%,0) scale(1.08);} }
        @keyframes rc-orb-b { 0%,100%{transform:translate3d(0,0,0) scale(1);} 50%{transform:translate3d(-6%,8%,0) scale(1.12);} }
        @keyframes rc-glow-ring { 0%,100%{box-shadow:0 0 0 0 rgba(255,138,31,0.45),0 0 28px 6px rgba(255,138,31,0.25);} 50%{box-shadow:0 0 0 10px rgba(255,138,31,0),0 0 40px 14px rgba(255,138,31,0.35);} }
        @keyframes rc-shimmer { 0%{transform:translateX(-150%);} 100%{transform:translateX(150%);} }
        @keyframes rc-fade-up { 0%{opacity:0;transform:translateY(6px);} 100%{opacity:1;transform:translateY(0);} }
        @keyframes rc-blink { 0%,80%,100%{opacity:.3;} 40%{opacity:1;} }
      `}</style>

      {/* ── Ambient background orbs (glassmorphic depth) ────────────── */}
      <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden rounded-xl">
        <div
          className="absolute -top-20 -left-20 h-72 w-72 rounded-full bg-orange-500/20 blur-3xl"
          style={{ animation: 'rc-orb-a 14s ease-in-out infinite' }}
        />
        <div
          className="absolute -bottom-20 -right-16 h-64 w-64 rounded-full bg-[#7bc4e2]/15 blur-3xl"
          style={{ animation: 'rc-orb-b 18s ease-in-out infinite' }}
        />
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-[#0a0e18]/40 to-[#0a0e18]/80" />
      </div>

      {/* ── Header ───────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-[11px] tracking-[1.1px] text-orange uppercase font-bold">
          <span
            className="w-1.5 h-1.5 rounded-full bg-orange shadow-[0_0_10px_2px_rgba(255,138,31,0.65)]"
            style={{ animation: 'rc-blink 1.6s ease-in-out infinite' }}
          />
          Research Chatbot
        </div>
        <span
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md
                     bg-gradient-to-br from-orange/30 to-orange/10
                     border border-orange/45 text-[9px] font-extrabold
                     text-[#ffd7a8] uppercase tracking-[0.6px]
                     backdrop-blur-md"
        >
          <LockIcon />
          PRO
        </span>
      </div>

      {/* ── Locked preview surface ──────────────────────────────────── */}
      <div
        className="relative flex-1 min-h-0 rounded-2xl overflow-hidden
                   border border-white/8
                   bg-white/[0.02] backdrop-blur-2xl
                   shadow-[inset_0_1px_0_rgba(255,255,255,0.06),0_30px_60px_-30px_rgba(0,0,0,0.7)]"
      >
        {/* Inner radial wash for depth */}
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(255,138,31,0.08),transparent_55%)]" />

        {/* Preview chat (blurred, non-interactive) */}
        <div
          aria-hidden
          className="absolute inset-0 flex flex-col gap-3 p-4 pointer-events-none
                     blur-[3px] opacity-70 select-none"
        >
          {SAMPLE_THREAD.map((m, i) => (
            <ChatBubble key={i} message={m} delay={i * 90} />
          ))}
          {/* Typing indicator */}
          <div
            className="self-start flex items-center gap-1.5 px-3 py-2 rounded-lg
                       bg-white/[0.05] border border-white/10 backdrop-blur-xl"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-orange/75" style={{ animation: 'rc-blink 1.2s ease-in-out infinite' }} />
            <span className="w-1.5 h-1.5 rounded-full bg-orange/75" style={{ animation: 'rc-blink 1.2s ease-in-out infinite', animationDelay: '120ms' }} />
            <span className="w-1.5 h-1.5 rounded-full bg-orange/75" style={{ animation: 'rc-blink 1.2s ease-in-out infinite', animationDelay: '240ms' }} />
          </div>
        </div>

        {/* Glass input row pinned at the bottom (disabled) */}
        <div
          aria-hidden
          className="absolute left-0 right-0 bottom-0 p-3 pointer-events-none"
        >
          <div
            className="flex items-center gap-2 rounded-xl px-3 py-2.5 opacity-60
                       bg-white/[0.04] backdrop-blur-2xl
                       border border-white/10
                       shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]"
          >
            <span className="text-muted/60">
              <ChatIcon />
            </span>
            <span className="flex-1 text-[12px] text-muted/65 italic">
              Ask the wind research bot anything…
            </span>
            <span className="relative overflow-hidden px-3 py-1 rounded-lg text-[10px] font-bold uppercase
                             bg-gradient-to-br from-orange/50 to-orange/25
                             border border-orange/40 text-[#ffd7a8] tracking-wider">
              Send
              <span
                aria-hidden
                className="absolute inset-y-0 -inset-x-2 w-1/3 bg-gradient-to-r from-transparent via-white/40 to-transparent"
                style={{ animation: 'rc-shimmer 3s ease-in-out infinite' }}
              />
            </span>
          </div>
        </div>

        {/* ── Lock overlay ──────────────────────────────────────────── */}
        <div className="absolute inset-0 grid place-items-center px-3 sm:px-0
                        bg-gradient-to-b from-[#0a0e18]/30 via-[#0a0e18]/60 to-[#0a0e18]/85
                        backdrop-blur-[3px]">
          <div
            className="relative w-full max-w-[360px] sm:max-w-[400px]
                       rounded-2xl border border-white/12
                       bg-gradient-to-br from-white/[0.06] via-white/[0.02] to-transparent
                       backdrop-blur-2xl
                       shadow-[0_30px_80px_-20px_rgba(255,138,31,0.32),inset_0_1px_0_rgba(255,255,255,0.08)]
                       p-3.5 sm:p-5"
            style={{ animation: 'rc-fade-up 0.5s cubic-bezier(0.22,1,0.36,1) both' }}
          >
            {/* Soft glow halo */}
            <div
              aria-hidden
              className="pointer-events-none absolute -top-12 -right-12 h-44 w-44 rounded-full
                         bg-orange/15 blur-3xl"
            />

            <div className="flex items-start gap-2.5 sm:gap-3">
              <div
                className="flex-shrink-0 grid place-items-center h-9 w-9 sm:h-11 sm:w-11 rounded-xl
                           bg-gradient-to-br from-orange/40 to-orange/15
                           border border-orange/55 text-orange"
                style={{ animation: 'rc-glow-ring 2.6s ease-in-out infinite' }}
              >
                <LockIcon />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-[9.5px] sm:text-[10px] font-extrabold uppercase tracking-[0.14em] text-orange/90">
                  CECL Pro · Research Chatbot
                </div>
                <h3 className="mt-1 text-[13.5px] sm:text-[15px] font-black text-text leading-tight">
                  Chat with the wind research bot
                </h3>
                <p className="mt-1.5 text-[11px] sm:text-[11.5px] leading-relaxed text-muted/95">
                  Trained on <b className="text-[#ffd0a0]">CECL&apos;s proprietary
                  Indian wind power archive</b> and authoritative public datasets
                  spanning <b className="text-[#ffd0a0]">2001 → 2026</b> —
                  policy orders, auction L1s, repowering economics, offshore
                  VGF frameworks. Answers cite primary sources.
                </p>

                {/* Training-source pills */}
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {TRAINING_BADGES.map((b, i) => (
                    <span
                      key={b}
                      className="text-[9px] uppercase tracking-wider font-bold
                                 px-1.5 py-0.5 rounded
                                 bg-white/[0.05] border border-white/10
                                 text-[#7bc4e2] backdrop-blur-md"
                      style={{
                        animation: 'rc-fade-up 0.5s cubic-bezier(0.22,1,0.36,1) both',
                        animationDelay: `${200 + i * 80}ms`,
                      }}
                    >
                      {b}
                    </span>
                  ))}
                </div>
              </div>
            </div>

            {/* CTA with shimmer */}
            <button
              className="group mt-4 sm:mt-5 relative w-full inline-flex items-center justify-center gap-2
                         rounded-lg overflow-hidden
                         bg-gradient-to-r from-orange via-[#ffb066] to-orange
                         text-[#0a0e18] px-3 sm:px-4 py-2 sm:py-2.5
                         text-[11px] sm:text-[11.5px] font-black uppercase tracking-[0.5px] sm:tracking-[0.6px]
                         shadow-[0_8px_24px_-6px_rgba(255,138,31,0.55)]
                         hover:shadow-[0_12px_32px_-6px_rgba(255,138,31,0.7)]
                         transition-shadow"
            >
              <span className="relative z-10">Unlock with CECL Pro</span>
              <span className="relative z-10 text-[14px] leading-none transition-transform group-hover:translate-x-0.5">→</span>
              <span
                aria-hidden
                className="absolute inset-y-0 -inset-x-4 w-1/2 bg-gradient-to-r from-transparent via-white/55 to-transparent"
                style={{ animation: 'rc-shimmer 3.4s ease-in-out infinite' }}
              />
            </button>

            <div className="mt-2.5 text-center text-[9.5px] text-muted/70">
              Includes full report access · state deep-dives · NIWE API
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Subcomponents ──────────────────────────────────────────────────────────
function ChatBubble({ message, delay }: { message: ChatMessage; delay: number }) {
  const isUser = message.role === 'user';
  return (
    <div
      className={`flex flex-col gap-1.5 ${isUser ? 'items-end' : 'items-start'}`}
      style={{
        animation: 'rc-fade-up 0.6s cubic-bezier(0.22,1,0.36,1) both',
        animationDelay: `${delay}ms`,
      }}
    >
      <div
        className={`max-w-[88%] rounded-2xl px-3 py-2 text-[11.5px] leading-relaxed
                    backdrop-blur-xl border
                   ${isUser
                     ? 'bg-gradient-to-br from-orange/30 to-orange/10 border-orange/35 text-[#ffd7a8]'
                     : 'bg-white/[0.06] border-white/10 text-text/95'}`}
      >
        {message.text}
      </div>
      {message.pills && (
        <div className="flex flex-wrap gap-1">
          {message.pills.map(p => (
            <span
              key={p}
              className="text-[9px] uppercase tracking-wider font-bold
                         px-1.5 py-0.5 rounded
                         bg-[#7bc4e2]/12 border border-[#7bc4e2]/30 text-[#7bc4e2]
                         backdrop-blur-md"
            >
              {p}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function LockIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="11" width="16" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 1 1 8 0v4" />
    </svg>
  );
}

function ChatIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
    </svg>
  );
}
