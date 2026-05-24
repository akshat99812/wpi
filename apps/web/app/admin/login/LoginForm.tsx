'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

export default function LoginForm({ from }: { from?: string }) {
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? 'Sign in failed.');
        setSubmitting(false);
        return;
      }
      const dest = from && from.startsWith('/admin/') ? from : '/admin/analytics';
      router.replace(dest);
      router.refresh();
    } catch {
      setError('Network error. Try again.');
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="mt-8 space-y-4">
      <label className="block">
        <span className="block text-xs uppercase tracking-wide text-muted">
          Username
        </span>
        <input
          autoFocus
          autoComplete="username"
          type="text"
          value={username}
          onChange={e => setUsername(e.target.value)}
          required
          className="mt-1 w-full rounded-md border border-border bg-panel px-3 py-2 text-sm text-text focus:border-orange focus:outline-none"
        />
      </label>
      <label className="block">
        <span className="block text-xs uppercase tracking-wide text-muted">
          Password
        </span>
        <input
          autoComplete="current-password"
          type="password"
          value={password}
          onChange={e => setPassword(e.target.value)}
          required
          className="mt-1 w-full rounded-md border border-border bg-panel px-3 py-2 text-sm text-text focus:border-orange focus:outline-none"
        />
      </label>
      {error && (
        <p
          role="alert"
          className="rounded-md border border-orange/40 bg-orange/10 px-3 py-2 text-sm text-orange"
        >
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={submitting}
        className="w-full rounded-md bg-orange py-2 text-sm font-semibold text-[#090d18] transition hover:bg-orange/90 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {submitting ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  );
}
