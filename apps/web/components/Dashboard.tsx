"use client";

import React, { useState } from 'react';
import { useWpiData, useRefresh } from '../hooks/useApi';
import TopBar from './TopBar';
import PortalShell from './PortalShell';

export default function Dashboard() {
  const { data: bundle, loading, error, refetch } = useWpiData();
  const { triggerRefresh, loading: isRefreshing } = useRefresh();
  const [adminToken] = useState('secret-admin-token-2024');

  const handleRefresh = async () => {
    try {
      await triggerRefresh(adminToken);
      refetch();
    } catch (err) {
      console.error(err);
      alert('Refresh failed. Check console for details.');
    }
  };

  if (loading && !bundle) {
    return (
      <>
        <TopBar onRefresh={handleRefresh} isRefreshing={isRefreshing} />
        <main className="flex-1 flex flex-col lg:flex-row gap-3 p-3 min-h-0 overflow-y-auto lg:overflow-hidden">

          {/* ── Left: map placeholder ── */}
          <section className="flex-[6] glass-panel rounded-xl flex flex-col overflow-hidden min-h-[50vh] lg:min-h-0">
            <div className="px-6 lg:px-8 py-3 border-b border-[#1e2c44] flex justify-between items-center flex-none">
              <div className="h-4 w-36 rounded bg-[#13192a] animate-pulse" />
              <div className="h-3 w-24 rounded bg-[#13192a] animate-pulse hidden md:block" />
            </div>
            <div className="flex-1 relative bg-[#0a0f1c]">
              {/* Subtle map-shaped shimmer */}
              <div className="absolute inset-0 animate-pulse bg-gradient-to-br from-[#0d1424] via-[#0a0f1c] to-[#0d1424]" />
            </div>
          </section>

          {/* ── Right: tab panel placeholder ── */}
          <section className="flex-[4] flex flex-col min-h-[55vh] lg:min-h-0 overflow-hidden gap-0">
            <div className="glass-panel rounded-xl flex-1 flex flex-col min-h-0 overflow-hidden">

              {/* Tab strip skeleton */}
              <div className="flex gap-2 border-b border-[#2a3a54] px-4 pt-3 pb-2.5 flex-none">
                {[18, 22, 16, 18, 14].map((w, i) => (
                  <div
                    key={i}
                    className={`h-5 rounded bg-[#13192a] animate-pulse`}
                    style={{ width: `${w * 4}px` }}
                  />
                ))}
              </div>

              {/* Card-shaped skeletons */}
              <div className="flex-1 p-4 flex flex-col gap-3 overflow-hidden">
                {[1, 2, 3, 4].map(i => (
                  <div
                    key={i}
                    className="rounded-xl border border-[#1e2c44] bg-[#0d1424] p-4 flex flex-col gap-2.5"
                  >
                    <div className="flex items-center gap-2">
                      <div className="w-5 h-5 rounded bg-[#13192a] animate-pulse" />
                      <div className="h-3 w-1/3 rounded bg-[#13192a] animate-pulse" />
                    </div>
                    <div className="h-4 w-3/4 rounded bg-[#13192a] animate-pulse" />
                    <div className="h-3 w-1/2 rounded bg-[#13192a] animate-pulse" />
                  </div>
                ))}
              </div>

              {/* Source-status bar skeleton */}
              <div className="flex-none border-t border-[#1a2138] px-4 py-3 flex items-center gap-3">
                <div className="h-3 w-20 rounded bg-[#13192a] animate-pulse" />
                <div className="flex gap-1.5 ml-auto">
                  {[1,2,3,4,5,6,7].map(i => (
                    <div key={i} className="w-2 h-2 rounded-full bg-[#13192a] animate-pulse" />
                  ))}
                </div>
              </div>
            </div>
          </section>
        </main>
      </>
    );
  }

  if (error && !bundle) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center bg-[#090d18] h-full w-full gap-2">
        <div className="text-red-500 text-sm font-mono font-bold px-4 py-2 bg-red-500/10 rounded-lg border border-red-500/20">
          System Error: {error}
        </div>
        <button 
          onClick={refetch}
          className="text-[11px] text-[#4cc87a] uppercase tracking-widest font-bold hover:underline"
        >
          Retry Connection
        </button>
      </div>
    );
  }

  return (
    <>
      <TopBar 
        generatedAt={bundle?.generatedAt} 
        onRefresh={handleRefresh} 
        isRefreshing={isRefreshing} 
      />
      <PortalShell bundle={bundle || null} />
    </>
  );
}
