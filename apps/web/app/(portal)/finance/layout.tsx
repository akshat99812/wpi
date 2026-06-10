"use client";

/**
 * Finance section layout.
 *
 * The Finance section used to be one cramped two-pane page (benchmarks on the
 * left, calculator on the right). It's now split into two focused sub-routes —
 * /finance/dashboard and /finance/calculator — with a persistent sidebar that
 * lets the user move between them. The sidebar lives here so it stays mounted
 * (and its active-pill animation persists) across sub-route navigations.
 */
import React from 'react';
import FinanceSidebar from '@/components/Engines/FinanceSidebar';

export default function FinanceLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex-1 flex flex-col lg:flex-row overflow-y-auto lg:overflow-hidden min-h-0">
      <FinanceSidebar />
      <section className="flex-1 min-w-0 bg-[#0a0e18] lg:overflow-y-auto custom-scrollbar">
        {children}
      </section>
    </main>
  );
}
