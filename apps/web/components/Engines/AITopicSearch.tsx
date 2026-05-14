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

const SUGGESTED_PROMPTS = [
  'Compare KERC vs GERC wind tariff orders',
  'Map of offshore wind zones and LiDAR buoy data',
  'Repowering potential for the sub-2 MW Tamil Nadu fleet',
  'FDRE vs RTC — auction terms compared',
];

export default function AITopicSearch() {
  return (
    <div className="relative flex flex-col h-full gap-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-[11px] tracking-[1.1px] text-orange uppercase font-bold">
          <div className="w-3.5 h-[2px] rounded bg-gradient-to-r from-orange to-transparent" />
          Research Chatbot
        </div>
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md
                         bg-gradient-to-br from-orange/25 to-orange/10
                         border border-orange/40 text-[9px] font-extrabold
                         text-[#ffd7a8] uppercase tracking-[0.6px]">
          <LockIcon />
          PRO
        </span>
      </div>

      {/* Locked preview surface — chat thread + input, both pointer-events
          disabled. The overlay sits on top to communicate gated access. */}
      <div className="relative flex-1 min-h-0 rounded-xl border border-border
                      bg-[#0a0e18] overflow-hidden">
        {/* Subtle radial wash for visual depth */}
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-br
                        from-orange/[0.04] via-transparent to-transparent" />

        <div
          aria-hidden
          className="absolute inset-0 flex flex-col gap-3 p-4 pointer-events-none
                     blur-[3px] opacity-70 select-none"
        >
          {SAMPLE_THREAD.map((m, i) => (
            <ChatBubble key={i} message={m} />
          ))}
          {/* Typing indicator under the last user message */}
          <div className="self-start flex items-center gap-1.5 px-3 py-2 rounded-lg
                          bg-[#131826] border border-[#1f2740]">
            <span className="w-1.5 h-1.5 rounded-full bg-orange/70 animate-pulse" />
            <span className="w-1.5 h-1.5 rounded-full bg-orange/70 animate-pulse" style={{ animationDelay: '120ms' }} />
            <span className="w-1.5 h-1.5 rounded-full bg-orange/70 animate-pulse" style={{ animationDelay: '240ms' }} />
          </div>
        </div>

        {/* Disabled input row anchored at the bottom — under the overlay */}
        <div
          aria-hidden
          className="absolute left-0 right-0 bottom-0 p-3 pointer-events-none
                     bg-gradient-to-t from-[#0a0e18] via-[#0a0e18]/95 to-transparent"
        >
          <div className="flex gap-2 items-center bg-[#0b0f19] border border-[#1a2138]
                          rounded-xl px-3 py-2.5 opacity-50">
            <span className="text-muted/55">
              <ChatIcon />
            </span>
            <span className="flex-1 text-[12px] text-muted/55 italic">
              Ask the wind research bot anything…
            </span>
            <span className="px-3 py-1 rounded-lg text-[10px] font-bold uppercase
                             bg-[#1a2133] text-muted/55 tracking-wider">
              Send
            </span>
          </div>
        </div>

        {/* ── Lock overlay ─────────────────────────────────────────────── */}
        <div className="absolute inset-0 grid place-items-center
                        bg-gradient-to-b from-[#0a0e18]/35 via-[#0a0e18]/65 to-[#0a0e18]/90
                        backdrop-blur-[1.5px]">
          <div className="wpi-card-in relative max-w-[380px] w-[88%]
                          rounded-2xl border border-orange/35
                          bg-gradient-to-br from-[#1a140a] via-[#0e1422] to-[#090d18]
                          shadow-[0_24px_60px_-20px_rgba(255,138,31,0.35)]
                          p-5">
            <div
              aria-hidden
              className="pointer-events-none absolute -top-12 -right-12 h-44 w-44 rounded-full
                         bg-orange/15 blur-3xl"
            />

            <div className="flex items-start gap-3">
              <div className="flex-shrink-0 grid place-items-center h-11 w-11 rounded-xl
                              bg-gradient-to-br from-orange/30 to-orange/10
                              border border-orange/45 text-orange">
                <LockIcon />
              </div>
              <div className="min-w-0">
                <div className="text-[10px] font-extrabold uppercase tracking-[0.14em] text-orange/90">
                  CECL Pro · Research Chatbot
                </div>
                <h3 className="mt-1 text-[15px] font-black text-text leading-tight">
                  Chat with the wind research bot
                </h3>
                <p className="mt-1.5 text-[11.5px] leading-relaxed text-muted">
                  Ask anything across <b className="text-[#ffd0a0]">SECI / CERC / NIWE / state SERC</b> orders,
                  auction L1s, repowering economics, and offshore VGF
                  frameworks. Answers cite primary sources.
                </p>
              </div>
            </div>

            {/* Suggested prompts (informational, not clickable in preview) */}
            <div className="mt-3 flex flex-col gap-1.5">
              {SUGGESTED_PROMPTS.map(p => (
                <div
                  key={p}
                  className="flex items-center gap-2 rounded-md
                             bg-[#0a0e18]/70 border border-[#1f2740]
                             px-2.5 py-1.5 text-[10.5px] text-muted/85"
                >
                  <span className="text-orange/70">›</span>
                  <span className="truncate">{p}</span>
                </div>
              ))}
            </div>

            {/* CTA */}
            <button
              className="mt-4 w-full inline-flex items-center justify-center gap-2
                         rounded-lg bg-gradient-to-r from-orange to-[#ffb066]
                         text-[#0a0e18] px-4 py-2.5
                         text-[11.5px] font-black uppercase tracking-[0.6px]
                         hover:opacity-95 transition-opacity"
            >
              Unlock with CECL Pro
              <span className="text-[14px] leading-none">→</span>
            </button>

            <div className="mt-2.5 text-center text-[9.5px] text-muted/65">
              Includes full report access · state deep-dives · NIWE API
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Subcomponents ──────────────────────────────────────────────────────────
function ChatBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === 'user';
  return (
    <div className={`flex flex-col gap-1.5 ${isUser ? 'items-end' : 'items-start'}`}>
      <div
        className={`max-w-[88%] rounded-2xl px-3 py-2 text-[11.5px] leading-relaxed
                   ${isUser
                     ? 'bg-gradient-to-br from-orange/25 to-orange/10 border border-orange/30 text-[#ffd7a8]'
                     : 'bg-[#131826] border border-[#1f2740] text-text/90'}`}
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
                         bg-[#7bc4e2]/12 border border-[#7bc4e2]/30 text-[#7bc4e2]"
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
