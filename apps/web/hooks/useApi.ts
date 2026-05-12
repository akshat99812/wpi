import { useState, useEffect, useCallback } from 'react';
import type { WpiBundle } from '@/lib/types';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'https://wpi-sjse.onrender.com';

export interface NewsData {
  generatedAt: string;
  news: WpiBundle['news'];
  policies: WpiBundle['policies'];
  analystReports: WpiBundle['analystReports'];
}

export interface TariffsData {
  generatedAt: string;
  auctions: WpiBundle['auctions'];
  tariffOrders: WpiBundle['tariffOrders'];
  lendingRates: WpiBundle['lendingRates'];
}

export function useNewsData() {
  const [data, setData] = useState<NewsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch(`${API_BASE}/api/news`);
      if (!res.ok) throw new Error('Failed to fetch news');
      setData(await res.json());
      setError(null);
    } catch (err: any) {
      setError(err.message || 'Error fetching news');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  return { data, loading, error, refetch: fetchData };
}

export function useTariffsData() {
  const [data, setData] = useState<TariffsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch(`${API_BASE}/api/tariffs`);
      if (!res.ok) throw new Error('Failed to fetch tariffs');
      setData(await res.json());
      setError(null);
    } catch (err: any) {
      setError(err.message || 'Error fetching tariffs');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  return { data, loading, error, refetch: fetchData };
}

export interface StateNewsPayload {
  generatedAt: string;
  state:       string;
  news:        WpiBundle['news'];
  cached?:     boolean;
  fallback?:   boolean;
}

export function useStateNews(state: string | null | undefined) {
  const [data, setData] = useState<StateNewsPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async (s: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/news/state/${encodeURIComponent(s)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as StateNewsPayload;
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error fetching state news');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!state) { setData(null); return; }
    fetchData(state);
  }, [state, fetchData]);

  return {
    data,
    loading,
    error,
    refetch: state ? () => fetchData(state) : () => {},
  };
}

export function useWpiData() {
  const [data, setData] = useState<WpiBundle | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch(`${API_BASE}/api/data`);
      if (!res.ok) throw new Error('Failed to fetch data');
      const json = await res.json();
      setData(json);
      setError(null);
    } catch (err: any) {
      setError(err.message || 'Error fetching data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return { data, loading, error, refetch: fetchData };
}

export function useApiHealth() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [health, setHealth] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchHealth = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/health`);
        if (!res.ok) throw new Error('Health check failed');
        const json = await res.json();
        setHealth(json);
      } catch (err: any) {
        setError(err.message || 'Error fetching health');
      } finally {
        setLoading(false);
      }
    };
    fetchHealth();
  }, []);

  return { health, loading, error };
}

export function useApiSources() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [sources, setSources] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchSources = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/sources`);
        if (!res.ok) throw new Error('Failed to fetch sources');
        const json = await res.json();
        setSources(json);
      } catch (err: any) {
        setError(err.message || 'Error fetching sources');
      } finally {
        setLoading(false);
      }
    };
    fetchSources();
  }, []);

  return { sources, loading, error };
}

export function useRefresh() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<boolean>(false);

  const triggerRefresh = async (token: string) => {
    setLoading(true);
    setError(null);
    setSuccess(false);
    try {
      const res = await fetch(`${API_BASE}/api/refresh`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || 'Failed to refresh data');
      }
      setSuccess(true);
      return await res.json();
    } catch (err: any) {
      setError(err.message || 'Error triggering refresh');
      throw err;
    } finally {
      setLoading(false);
    }
  };

  return { triggerRefresh, loading, error, success };
}
