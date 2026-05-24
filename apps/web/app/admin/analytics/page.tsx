import Link from 'next/link';
import {
  fetchPageviewBuckets,
  fetchStats,
  fetchTopMetric,
  isUmamiConfigured,
  type UmamiBuckets,
  type UmamiMetric,
  type UmamiStats,
  type UmamiUnit,
} from '@/lib/umami';
import ActiveUsersPanel from './ActiveUsersPanel';
import Chart from './Chart';
import DateRangePicker from './DateRangePicker';
import SignOutButton from './SignOutButton';

export const metadata = {
  title: 'Analytics — Wind Power India',
};

export const dynamic = 'force-dynamic';

const RANGE_LABELS = {
  today: 'Today',
  '7d': '7 days',
  '30d': '30 days',
} as const;
type PresetRange = keyof typeof RANGE_LABELS;

interface ResolvedRange {
  startAt: number;
  endAt: number;
  preset: PresetRange | null;
  start?: string;
  end?: string;
}

function resolveRange(sp: { range?: string; start?: string; end?: string }): ResolvedRange {
  if (sp.start && sp.end) {
    const s = Date.parse(`${sp.start}T00:00:00Z`);
    const e = Date.parse(`${sp.end}T23:59:59Z`);
    if (Number.isFinite(s) && Number.isFinite(e) && e > s) {
      return { startAt: s, endAt: e, preset: null, start: sp.start, end: sp.end };
    }
  }
  const r: PresetRange =
    sp.range === 'today' || sp.range === '30d' ? sp.range : '7d';
  const endAt = Date.now();
  if (r === 'today') {
    const now = new Date();
    const startAt = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    return { startAt, endAt, preset: r };
  }
  const days = r === '7d' ? 7 : 30;
  return { startAt: endAt - days * 86_400_000, endAt, preset: r };
}

function pickUnit(startAt: number, endAt: number): UmamiUnit {
  const days = (endAt - startAt) / 86_400_000;
  if (days <= 2) return 'hour';
  if (days <= 90) return 'day';
  return 'month';
}

function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0s';
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  if (m < 60) return s ? `${m}m ${s}s` : `${m}m`;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return mm ? `${h}h ${mm}m` : `${h}h`;
}

function countryName(code: string): string {
  if (!code) return 'Unknown';
  try {
    const display = new Intl.DisplayNames(['en'], {
      type: 'region',
      fallback: 'code',
    });
    return display.of(code.toUpperCase()) ?? code;
  } catch {
    return code;
  }
}

export default async function AdminAnalyticsPage({
  searchParams,
}: {
  searchParams: { range?: string; start?: string; end?: string };
}) {
  if (!isUmamiConfigured()) {
    return <ConfigMissing />;
  }

  const range = resolveRange(searchParams);
  const unit = pickUnit(range.startAt, range.endAt);

  let dashboard: {
    stats: UmamiStats;
    topPages: UmamiMetric[];
    topReferrers: UmamiMetric[];
    topCountries: UmamiMetric[];
    buckets: UmamiBuckets;
  } | null = null;
  let errorMessage: string | null = null;

  try {
    const [stats, topPages, topReferrers, topCountries, buckets] = await Promise.all([
      fetchStats(range.startAt, range.endAt),
      fetchTopMetric('url', range.startAt, range.endAt),
      fetchTopMetric('referrer', range.startAt, range.endAt),
      fetchTopMetric('country', range.startAt, range.endAt),
      fetchPageviewBuckets(range.startAt, range.endAt, unit),
    ]);
    dashboard = { stats, topPages, topReferrers, topCountries, buckets };
  } catch (err) {
    errorMessage = err instanceof Error ? err.message : 'Failed to fetch Umami stats.';
  }

  return (
    <main className="min-h-screen bg-[#090d18] text-text">
      <div className="mx-auto max-w-6xl px-6 py-10">
        <header className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <h1 className="text-2xl font-semibold">
              windpowerindia.com <span className="text-muted">— analytics</span>
            </h1>
            <div className="flex items-center gap-3">
              <ActiveUsersPanel />
              <SignOutButton />
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <nav className="flex gap-1 rounded-md border border-border bg-panel p-1 text-sm">
              {(Object.keys(RANGE_LABELS) as PresetRange[]).map(r => (
                <Link
                  key={r}
                  href={`/admin/analytics?range=${r}`}
                  className={`rounded px-3 py-1.5 transition ${
                    r === range.preset
                      ? 'bg-orange text-[#090d18]'
                      : 'text-muted hover:text-text'
                  }`}
                >
                  {RANGE_LABELS[r]}
                </Link>
              ))}
            </nav>
            <DateRangePicker start={range.start} end={range.end} />
          </div>
        </header>

        {errorMessage ? (
          <p className="mt-10 rounded-lg border border-orange/40 bg-orange/10 p-4 text-sm text-orange">
            {errorMessage}
          </p>
        ) : dashboard ? (
          <Dashboard data={dashboard} unit={unit} />
        ) : null}
      </div>
    </main>
  );
}

function Dashboard({
  data,
  unit,
}: {
  data: {
    stats: UmamiStats;
    topPages: UmamiMetric[];
    topReferrers: UmamiMetric[];
    topCountries: UmamiMetric[];
    buckets: UmamiBuckets;
  };
  unit: UmamiUnit;
}) {
  const { stats, topPages, topReferrers, topCountries, buckets } = data;

  const bounceNow = stats.visits.value > 0 ? (stats.bounces.value / stats.visits.value) * 100 : 0;
  const bouncePrev = stats.visits.prev > 0 ? (stats.bounces.prev / stats.visits.prev) * 100 : 0;

  const avgNow = stats.visits.value > 0 ? stats.totaltime.value / stats.visits.value : 0;
  const avgPrev = stats.visits.prev > 0 ? stats.totaltime.prev / stats.visits.prev : 0;

  const ppsNow = stats.visits.value > 0 ? stats.pageviews.value / stats.visits.value : 0;
  const ppsPrev = stats.visits.prev > 0 ? stats.pageviews.prev / stats.visits.prev : 0;

  return (
    <>
      <section className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <StatCard label="Pageviews" value={stats.pageviews.value} prev={stats.pageviews.prev} />
        <StatCard label="Visitors" value={stats.visitors.value} prev={stats.visitors.prev} />
        <StatCard label="Sessions" value={stats.visits.value} prev={stats.visits.prev} />
        <StatCard
          label="Avg session"
          value={avgNow}
          prev={avgPrev}
          displayValue={formatDuration(avgNow)}
        />
        <StatCard
          label="Pages / session"
          value={ppsNow}
          prev={ppsPrev}
          displayValue={ppsNow.toFixed(1)}
        />
        <StatCard
          label="Bounce rate"
          value={bounceNow}
          prev={bouncePrev}
          displayValue={`${Math.round(bounceNow)}%`}
          higherIsBetter={false}
        />
      </section>

      <section className="mt-6 rounded-lg border border-border bg-panel p-4">
        <div className="mb-3 flex items-center justify-between">
          <div className="text-xs uppercase tracking-wide text-muted">
            Activity over time
          </div>
          <div className="flex gap-4 text-xs text-muted">
            <Legend color="#ff8a1f" label="Pageviews" />
            <Legend color="#58a6ff" label="Sessions" />
          </div>
        </div>
        <Chart pageviews={buckets.pageviews} sessions={buckets.sessions} unit={unit} />
      </section>

      <section className="mt-8 grid gap-6 md:grid-cols-3">
        <TopList title="Top pages" rows={topPages} />
        <TopList title="Top referrers" rows={topReferrers} emptyLabel="Direct" />
        <TopList
          title="Top countries"
          rows={topCountries.map(r => ({ ...r, x: countryName(r.x) }))}
        />
      </section>
    </>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span
        className="inline-block h-2 w-3 rounded"
        style={{ backgroundColor: color }}
      />
      {label}
    </span>
  );
}

function StatCard({
  label,
  value,
  prev,
  displayValue,
  higherIsBetter = true,
}: {
  label: string;
  value: number;
  prev?: number;
  displayValue?: string;
  higherIsBetter?: boolean;
}) {
  const delta = prev != null && prev > 0 ? ((value - prev) / prev) * 100 : null;
  const isUp = delta != null && delta > 0;
  const isDown = delta != null && delta < 0;
  const good = (isUp && higherIsBetter) || (isDown && !higherIsBetter);
  const bad = (isDown && higherIsBetter) || (isUp && !higherIsBetter);

  return (
    <div className="rounded-lg border border-border bg-panel p-4">
      <div className="text-xs uppercase tracking-wide text-muted">{label}</div>
      <div className="mt-2 text-2xl font-semibold tabular-nums">
        {displayValue ?? value.toLocaleString('en-IN')}
      </div>
      {delta != null && Number.isFinite(delta) && (
        <div
          className={`mt-1 flex items-center gap-1 text-xs tabular-nums ${
            good ? 'text-success' : bad ? 'text-orange' : 'text-muted'
          }`}
        >
          <span aria-hidden>{isUp ? '▲' : isDown ? '▼' : '—'}</span>
          {Math.abs(delta).toFixed(0)}% <span className="text-muted">vs prev</span>
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
          <code className="rounded bg-panel px-1.5 py-0.5">UMAMI_USERNAME</code>,{' '}
          <code className="rounded bg-panel px-1.5 py-0.5">UMAMI_PASSWORD</code>, and{' '}
          <code className="rounded bg-panel px-1.5 py-0.5">
            NEXT_PUBLIC_UMAMI_WEBSITE_ID
          </code>{' '}
          in the production environment, then redeploy the web container.
        </p>
      </div>
    </main>
  );
}
