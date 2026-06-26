"use client";

import React from 'react';

/**
 * Research → Chatbot tab. The Pro RAG assistant over 25 years of Indian
 * wind-energy directories is not yet live — we show a "coming soon" banner
 * in its place. The sidebar (in the research layout) keeps switching between
 * this, Intelligence, and Policy.
 */
const ChatbotIcon = ({ className = '' }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
       strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
       className={className} aria-hidden>
    <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
  </svg>
);

export default function ResearchChatbotPage() {
  return (
    <div className="flex-1 flex items-center justify-center p-6 overflow-y-auto custom-scrollbar">
      <div className="relative w-full max-w-lg text-center rounded-2xl border border-[#1f2740]
                      bg-gradient-to-b from-[#0c1120] to-[#0a0e18] px-8 py-12
                      shadow-[0_0_60px_rgba(255,138,31,0.06)]">
        <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-2xl
                        bg-gradient-to-br from-[#ff9a3c] to-[#ff7a1f]
                        shadow-[0_0_28px_rgba(255,138,31,0.45)]">
          <ChatbotIcon className="h-8 w-8 text-[#0a0e18]" />
        </div>

        <span className="inline-block rounded-full border border-orange/40 bg-orange/10
                         px-3 py-1 text-[10px] font-bold uppercase tracking-[1.5px] text-orange">
          Coming soon
        </span>

        <h1 className="mt-4 text-2xl font-bold text-white">Research Chatbot</h1>

        <p className="mx-auto mt-3 max-w-sm text-sm leading-relaxed text-white/55">
          Our RAG assistant trained on 25 years of Indian wind-energy directories
          is on its way. Check back soon — in the meantime, explore the
          Intelligence and Policy tabs.
        </p>
      </div>
    </div>
  );
}
