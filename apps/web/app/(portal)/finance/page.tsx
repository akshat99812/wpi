"use client";

import React from 'react';
import BankabilityCalc from '@/components/Engines/BankabilityCalc';

/**
 * Finance landing page = the 25-yr Bankability Calculator (the default tool).
 * The market-benchmarks dashboard lives at /finance/benchmarks. The sidebar
 * (in the finance layout) switches between the two.
 */
export default function FinancePage() {
  return (
    <div className="w-full max-w-[1500px] mx-auto px-4 sm:px-6 lg:px-8 py-5 lg:py-8">
      <BankabilityCalc />
    </div>
  );
}
