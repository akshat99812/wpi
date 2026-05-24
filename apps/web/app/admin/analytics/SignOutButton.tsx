'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

export default function SignOutButton() {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);

  async function signOut() {
    setSubmitting(true);
    try {
      await fetch('/api/admin/logout', { method: 'POST' });
    } finally {
      router.replace('/admin/login');
      router.refresh();
    }
  }

  return (
    <button
      onClick={signOut}
      disabled={submitting}
      className="rounded-md border border-border bg-panel px-3 py-1.5 text-sm text-muted transition hover:text-text disabled:opacity-60"
    >
      {submitting ? 'Signing out…' : 'Sign out'}
    </button>
  );
}
