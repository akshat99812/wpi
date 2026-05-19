"use client";

/**
 * Portal layout — shared chrome for /geospatial, /finance, /research.
 *
 * Owns:
 *   - The bundle fetch (via BundleProvider).
 *   - The TopBar (mounted once; persists across navigations between
 *     the three portal pages, so switching tabs only swaps the body).
 */

import React from 'react';
import TopBar from '@/components/TopBar';
import { BundleProvider, useBundle } from '@/lib/BundleContext';

function PortalChrome({ children }: { children: React.ReactNode }) {
  const { bundle, isRefreshing, handleRefresh } = useBundle();
  return (
    <>
      <TopBar
        generatedAt={bundle?.generatedAt}
        onRefresh={handleRefresh}
        isRefreshing={isRefreshing}
        windPotentialGw={bundle?.windPotential?.total_150m_gw}
      />
      {children}
    </>
  );
}

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  return (
    <BundleProvider>
      <div className="flex flex-col min-h-screen lg:h-screen w-screen overflow-x-hidden lg:overflow-hidden bg-[#090d18]">
        <PortalChrome>{children}</PortalChrome>
      </div>
    </BundleProvider>
  );
}
