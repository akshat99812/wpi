import Link from 'next/link';
import {
  fetchStats,
  fetchTopMetric,
  isUmamiConfigured,
  type UmamiMetric,
} from '@/lib/umami';
import SignOutButton from './SignOutButton';

export const metadata = {
  title: 'Analytics — Wind Power India',
};

export const dynamic = 'force-dynamic';

type Range = 'today' | '7d' | '30d';

const RANGE_LABELS: Record<Range, string> = {
  today: 'Today',
  '7d': '7 days',
  '30d': '30 days',
};

function parseRange(raw: string | string[] | undefined): Range {
  return raw === 'today' || raw === '30d' ? raw : '7d';
}

function rangeBounds(range: Range): { startAt: number; endAt: number } {
  const endAt = Date.now();
  if (range === 'today') {
    const now = new Date();
    const startAt = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    return { startAt, endAt };
  }
  const days = range === '7d' ? 7 : 30;
  return { startAt: endAt - days * 24 * 60 * 60 * 1000, endAt };
}

export default async function AdminAnalyticsPage({
  searchParams,
}: {
  searchParams: { range?: string | string[] };
}) {
  if (!isUmamiConfigured()) {
    return <ConfigMissing />;
  }

  const range = parseRange(searchParams.range);
  const { startAt, endAt } = rangeBounds(range);

  let data:
    | {
        stats: Awaited<ReturnType<typeof fetchStats>>;
        topPages: UmamiMetric[];
        topReferrers: UmamiMetric[];
        topCountries: UmamiMetric[];
      }
    | null = null;
  let errorMessage: string | null = null;

  try {
    const [stats, topPages, topReferrers, topCountries] = await Promise.all([
      fetchStats(startAt, endAt),
      fetchTopMetric('url', startAt, endAt),
      fetchTopMetric('referrer', startAt, endAt),
      fetchTopMetric('country', startAt, endAt),
    ]);
    data = { stats, topPages, topReferrers, topCountries };
  } catch (err) {
    errorMessage = err instanceof Error ? err.message : 'Failed to fetch Umami stats.';
  }

  return (
    <main className="min-h-screen bg-[#090d18] text-text">
      <div className="mx-auto max-w-6xl px-6 py-10">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <h1 className="text-2xl font-semibold">
            windpowerindia.com <span className="text-muted">— analytics</span>
          </h1>
          <div className="flex items-center gap-3">
            <nav className="flex gap-1 rounded-md border border-border bg-panel p-1 text-sm">
              {(Object.keys(RANGE_LABELS) as Range[]).map((r) => (
                <Link
                  key={r}
                  href={`/admin/analytics?range=${r}`}
                  className={`rounded px-3 py-1.5 transition ${
                    r === range
                      ? 'bg-orange text-[#090d18]'
                      : 'text-muted hover:text-text'
                  }`}
                >
                  {RANGE_LABELS[r]}
                </Link>
              ))}
            </nav>
            <SignOutButton />
          </div>
        </header>

        {errorMessage ? (
          <p className="mt-10 rounded-lg border border-orange/40 bg-orange/10 p-4 text-sm text-orange">
            {errorMessage}
          </p>
        ) : data ? (
          <Dashboard data={data} />
        ) : null}
      </div>
    </main>
  );
}

function Dashboard({
  data,
}: {
  data: {
    stats: Awaited<ReturnType<typeof fetchStats>>;
    topPages: UmamiMetric[];
    topReferrers: UmamiMetric[];
    topCountries: UmamiMetric[];
  };
}) {
  const { stats, topPages, topReferrers, topCountries } = data;
  const bounceRate =
    stats.visits.value > 0
      ? Math.round((stats.bounces.value / stats.visits.value) * 100)
      : 0;
  const bouncePrev =
    stats.visits.prev > 0 ? (stats.bounces.prev / stats.visits.prev) * 100 : undefined;

  return (
    <>
      <section className="mt-8 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard
          label="Pageviews"
          value={stats.pageviews.value}
          prev={stats.pageviews.prev}
        />
        <StatCard
          label="Visitors"
          value={stats.visitors.value}
          prev={stats.visitors.prev}
        />
        <StatCard
          label="Sessions"
          value={stats.visits.value}
          prev={stats.visits.prev}
        />
        <StatCard
          label="Bounce rate"
          value={bounceRate}
          prev={bouncePrev}
          suffix="%"
          higherIsBetter={false}
        />
      </section>

      <section className="mt-8 grid gap-6 md:grid-cols-3">
        <TopList title="Top pages" rows={topPages} />
        <TopList title="Top referrers" rows={topReferrers} emptyLabel="Direct" />
        <TopList title="Top countries" rows={topCountries} />
      </section>
    </>
  );
}

function StatCard({
  label,
  value,
  prev,
  suffix = '',
  higherIsBetter = true,
}: {
  label: string;
  value: number;
  prev?: number;
  suffix?: string;
  higherIsBetter?: boolean;
}) {
  const delta =
    prev != null && prev > 0 ? ((value - prev) / prev) * 100 : null;
  const isUp = delta != null && delta > 0;
  const isDown = delta != null && delta < 0;
  const good = (isUp && higherIsBetter) || (isDown && !higherIsBetter);
  const bad = (isDown && higherIsBetter) || (isUp && !higherIsBetter);

  return (
    <div className="rounded-lg border border-border bg-panel p-4">
      <div className="text-xs uppercase tracking-wide text-muted">{label}</div>
      <div className="mt-2 text-2xl font-semibold tabular-nums">
        {value.toLocaleString('en-IN')}
        {suffix}
      </div>
      {delta != null && Number.isFinite(delta) && (
        <div
          className={`mt-1 text-xs tabular-nums ${
            good ? 'text-success' : bad ? 'text-orange' : 'text-muted'
          }`}
        >
          {isUp ? '▲' : isDown ? '▼' : '—'} {Math.abs(delta).toFixed(0)}% vs prev
        </div>
      )}
    </div>
  );
}

function TopList({
  title,
  rows,
  emptyLabel = '—',
}: {
  title: string;
  rows: UmamiMetric[];
  emptyLabel?: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-panel p-4">
      <div className="mb-3 text-xs uppercase tracking-wide text-muted">{title}</div>
      {rows.length === 0 ? (
        <p className="text-sm text-muted">No data yet.</p>
      ) : (
        <ul className="space-y-1.5 text-sm">
          {rows.slice(0, 10).map((row, i) => (
            <li
              key={`${row.x}-${i}`}
              className="flex items-center justify-between gap-3"
            >
              <span className="truncate" title={row.x || emptyLabel}>
                {row.x || emptyLabel}
              </span>
              <span className="shrink-0 tabular-nums text-muted">
                {row.y.toLocaleString('en-IN')}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ConfigMissing() {
  return (
    <main className="min-h-screen bg-[#090d18] text-text">
      <div className="mx-auto max-w-2xl px-6 py-24">
        <h1 className="text-2xl font-semibold">Analytics</h1>
        <p className="mt-4 text-sm text-muted">
          Set{' '}
          <code className="rounded bg-panel px-1.5 py-0.5">UMAMI_API_URL</code>,{' '}
          <code className="rounded bg-panel px-1.5 py-0.5">UMAMI_API_TOKEN</code>,
          and{' '}
          <code className="rounded bg-panel px-1.5 py-0.5">
            NEXT_PUBLIC_UMAMI_WEBSITE_ID
          </code>{' '}
          in the production environment, then redeploy the web container.
        </p>
      </div>
    </main>
  );
}
