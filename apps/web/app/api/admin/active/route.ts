import { NextResponse } from 'next/server';
import { fetchActiveUsers, isUmamiConfigured } from '@/lib/umami';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  if (!isUmamiConfigured()) {
    return NextResponse.json({ error: 'Umami not configured.' }, { status: 503 });
  }
  try {
    const data = await fetchActiveUsers();
    return NextResponse.json({ visitors: data.visitors ?? 0 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to fetch active users.' },
      { status: 502 },
    );
  }
}
