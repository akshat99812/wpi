"use client";

/**
 * Research section layout.
 *
 * The Research section is now a three-tab workspace — Chatbot, Intelligence,
 * and Policy — fronted by a persistent sidebar (mirroring the Finance section).
 * The sidebar lives here so it stays mounted (and its active-pill animation
 * persists) across sub-route navigations.
 */
import React from 'react';
import ResearchSidebar from '@/components/Engines/ResearchSidebar';

export default function ResearchLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex-1 flex flex-col lg:flex-row overflow-y-auto lg:overflow-hidden min-h-0">
      <ResearchSidebar />
      <section className="flex-1 min-w-0 min-h-0 flex flex-col bg-[#0a0e18]">
        {children}
      </section>
    </main>
  );
}
