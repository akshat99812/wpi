"use client";

import React, { useState } from 'react';
import { useWpiData, useRefresh } from '../hooks/useApi';
import TopBar from './TopBar';
import PortalShell from './PortalShell';

export default function Dashboard() {
  const { data: bundle, loading, error, refetch } = useWpiData();
  const { triggerRefresh, loading: isRefreshing } = useRefresh();
  const [adminToken, setAdminToken] = useState('secret-admin-token-2024');

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
      <div className="flex-1 flex flex-col items-center justify-center bg-[#090d18] h-full w-full">
        <div className="w-8 h-8 rounded-full border-2 border-[#4cc87a] border-t-transparent animate-spin mb-4" />
        <span className="text-[#4cc87a] text-[11px] uppercase tracking-widest font-bold">Connecting to Intelligence Hub...</span>
      </div>
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
