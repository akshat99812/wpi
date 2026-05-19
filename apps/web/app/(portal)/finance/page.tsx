"use client";

import React from 'react';
import FinanceDashboard from '@/components/Engines/FinanceDashboard';
import BankabilityCalc from '@/components/Engines/BankabilityCalc';

export default function FinancePage() {
  return (
    <main className="flex-1 grid grid-cols-1 lg:grid-cols-[1.05fr_0.95fr] overflow-y-auto lg:overflow-hidden min-h-0">
      <section className="bg-[#0a0e18] border-b lg:border-b-0 lg:border-r border-[#1f2740] lg:overflow-y-auto custom-scrollbar p-3 sm:p-4 lg:p-5">
        <FinanceDashboard />
      </section>
      <section className="bg-[#0c1120] lg:overflow-y-auto custom-scrollbar p-3 sm:p-4 lg:p-5">
        <BankabilityCalc />
      </section>
    </main>
  );
}
