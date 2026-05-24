'use client';

import { useEffect, useState } from 'react';

const POLL_MS = 10_000;

export default function ActiveUsersPanel() {
  const [count, setCount] = useState<number | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function poll() {
      try {
        const res = await fetch('/api/admin/active', { cache: 'no-store' });
        if (!res.ok) throw new Error(String(res.status));
        const data = (await res.json()) as { visitors?: number };
        if (!cancelled) {
          setCount(data.visitors ?? 0);
          setError(false);
        }
      } catch {
        if (!cancelled) setError(true);
      }
    }
    poll();
    const id = setInterval(poll, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  const live = count != null && count > 0;
  const label = error
    ? '—'
    : count == null
      ? '…'
      : `${count} active now`;

  return (
    <div
      className="flex items-center gap-2 rounded-md border border-border bg-panel px-3 py-1.5 text-sm"
      title={error ? 'Could not reach analytics' : 'Visitors active in the last 5 minutes'}
    >
      <span
        className={`relative inline-flex h-2 w-2 rounded-full ${
          live ? 'bg-success' : 'bg-muted/70'
        }`}
      >
        {live && (
          <span className="absolute inset-0 animate-ping rounded-full bg-success opacity-60" />
        )}
      </span>
      <span className="tabular-nums text-muted">
        <span className="font-semibold text-text">{label}</span>
      </span>
    </div>
  );
}
