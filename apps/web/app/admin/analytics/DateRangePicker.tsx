'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

export default function DateRangePicker({
  start,
  end,
}: {
  start?: string;
  end?: string;
}) {
  const router = useRouter();
  const [s, setS] = useState(start ?? '');
  const [e, setE] = useState(end ?? '');

  const today = new Date().toISOString().slice(0, 10);
  const disabled = !s || !e || s > e;

  function onApply(ev: React.FormEvent) {
    ev.preventDefault();
    if (disabled) return;
    const params = new URLSearchParams({ start: s, end: e });
    router.push(`/admin/analytics?${params.toString()}`);
  }

  return (
    <form
      onSubmit={onApply}
      className="flex flex-wrap items-center gap-2 text-sm"
    >
      <input
        type="date"
        value={s}
        max={e || today}
        onChange={ev => setS(ev.target.value)}
        className="rounded-md border border-border bg-panel px-2 py-1.5 text-text focus:border-orange focus:outline-none [color-scheme:dark]"
        aria-label="Start date"
      />
      <span className="text-muted">→</span>
      <input
        type="date"
        value={e}
        min={s || undefined}
        max={today}
        onChange={ev => setE(ev.target.value)}
        className="rounded-md border border-border bg-panel px-2 py-1.5 text-text focus:border-orange focus:outline-none [color-scheme:dark]"
        aria-label="End date"
      />
      <button
        type="submit"
        disabled={disabled}
        className="rounded-md bg-orange px-3 py-1.5 text-sm font-semibold text-[#090d18] transition hover:bg-orange/90 disabled:cursor-not-allowed disabled:opacity-40"
      >
        Apply
      </button>
    </form>
  );
}
