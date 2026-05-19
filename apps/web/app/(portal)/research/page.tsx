"use client";

import React from 'react';
import ResearchDashboard from '@/components/Engines/ResearchDashboard';
import AITopicSearch from '@/components/Engines/AITopicSearch';
import { useBundle } from '@/lib/BundleContext';

export default function ResearchPage() {
  const { bundle } = useBundle();
  return (
    <main className="flex-1 grid grid-cols-1 lg:grid-cols-[1.05fr_0.95fr] overflow-y-auto lg:overflow-hidden min-h-0">
      <section className="bg-[#0a0e18] border-b lg:border-b-0 lg:border-r border-[#1f2740] lg:overflow-y-auto custom-scrollbar p-3 sm:p-4 lg:p-5">
        <ResearchDashboard potentialGw={bundle?.windPotential?.total_150m_gw} />
      </section>
      <section className="bg-[#0c1120] lg:overflow-y-auto custom-scrollbar p-3 sm:p-4 lg:p-5 min-h-[560px] lg:min-h-0">
        <AITopicSearch />
      </section>
    </main>
  );
}
