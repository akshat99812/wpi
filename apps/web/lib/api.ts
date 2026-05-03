import type { WpiBundle } from '@/lib/types';

export const fetchWpiData = async (): Promise<WpiBundle | null> => {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3005';
  try {
    const res = await fetch(`${apiUrl}/api/data`, { cache: 'no-store' });
    if (!res.ok) {
      console.error('WPI API error, status:', res.status);
      return null;
    }
    return res.json() as Promise<WpiBundle>;
  } catch (err) {
    console.error('WPI API unreachable:', err);
    return null;
  }
};
