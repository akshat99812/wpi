"use client";

import React from 'react';
import PortalShell from './PortalShell';
import GeospatialSkeleton from './skeletons/GeospatialSkeleton';
import { useBundle } from '@/lib/BundleContext';

export default function Dashboard() {
  const { bundle, loading, error, refetch } = useBundle();

  if (loading && !bundle) return <GeospatialSkeleton />;

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

  return <PortalShell bundle={bundle || null} />;
}
