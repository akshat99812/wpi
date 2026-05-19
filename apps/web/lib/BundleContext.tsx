"use client";

/**
 * BundleContext — shares one bundle fetch across every page mounted
 * under app/(portal)/layout.tsx. Without this, navigating between
 * Geospatial / Finance / Research would re-mount the page-level hook
 * and refire `/api/data` on every switch, which (combined with the
 * cost of mounting MapCanvas on the Geospatial page) made the nav
 * to Geospatial feel laggy.
 *
 * The portal layout wraps its children in a single <BundleProvider>;
 * pages and TopBar consume the bundle via useBundle().
 */

import React, { createContext, useCallback, useContext, useMemo } from 'react';
import type { WpiBundle } from '@/lib/types';
import { useWpiData, useRefresh } from '@/hooks/useApi';

interface BundleContextValue {
  bundle:        WpiBundle | null;
  loading:       boolean;
  error:         string | null;
  refetch:       () => void;
  isRefreshing:  boolean;
  handleRefresh: () => Promise<void>;
}

const BundleCtx = createContext<BundleContextValue | null>(null);

const ADMIN_TOKEN = 'secret-admin-token-2024';

export function BundleProvider({ children }: { children: React.ReactNode }) {
  const { data: bundle, loading, error, refetch } = useWpiData();
  const { triggerRefresh, loading: isRefreshing } = useRefresh();

  const handleRefresh = useCallback(async () => {
    try {
      await triggerRefresh(ADMIN_TOKEN);
      refetch();
    } catch (err) {
      console.error(err);
      if (typeof window !== 'undefined') {
        window.alert('Refresh failed. Check console for details.');
      }
    }
  }, [triggerRefresh, refetch]);

  const value = useMemo<BundleContextValue>(
    () => ({ bundle, loading, error, refetch, isRefreshing, handleRefresh }),
    [bundle, loading, error, refetch, isRefreshing, handleRefresh]
  );

  return <BundleCtx.Provider value={value}>{children}</BundleCtx.Provider>;
}

export function useBundle(): BundleContextValue {
  const ctx = useContext(BundleCtx);
  if (!ctx) {
    throw new Error('useBundle must be used inside <BundleProvider> (app/(portal)/layout.tsx)');
  }
  return ctx;
}
