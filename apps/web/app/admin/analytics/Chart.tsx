import type { UmamiMetric, UmamiUnit } from '@/lib/umami';

interface ChartProps {
  pageviews: UmamiMetric[];
  sessions: UmamiMetric[];
  unit: UmamiUnit;
}

const VIEW_W = 800;
const VIEW_H = 240;
const PAD = { top: 12, right: 16, bottom: 28, left: 40 };

const COLORS = {
  pageviews: '#ff8a1f',
  sessions: '#58a6ff',
  grid: '#27324a',
  axis: '#9aa4ba',
};

export default function Chart({ pageviews, sessions, unit }: ChartProps) {
  const n = pageviews.length;
  if (n === 0) {
    return (
      <div className="flex h-60 items-center justify-center text-sm text-muted">
        No activity in this range.
      </div>
    );
  }

  const innerW = VIEW_W - PAD.left - PAD.right;
  const innerH = VIEW_H - PAD.top - PAD.bottom;

  const max = Math.max(
    1,
    ...pageviews.map(p => p.y),
    ...sessions.map(s => s.y),
  );

  const xAt = (i: number) =>
    n > 1 ? PAD.left + (i / (n - 1)) * innerW : PAD.left + innerW / 2;
  const yAt = (v: number) => PAD.top + innerH - (v / max) * innerH;

  const linePath = (data: UmamiMetric[]) =>
    data
      .map((d, i) => `${i === 0 ? 'M' : 'L'} ${xAt(i).toFixed(1)} ${yAt(d.y).toFixed(1)}`)
      .join(' ');

  const areaPath = (data: UmamiMetric[]) => {
    const baseY = PAD.top + innerH;
    const points = data
      .map((d, i) => `L ${xAt(i).toFixed(1)} ${yAt(d.y).toFixed(1)}`)
      .join(' ');
    return `M ${xAt(0).toFixed(1)} ${baseY} ${points} L ${xAt(n - 1).toFixed(1)} ${baseY} Z`;
  };

  // Four horizontal grid lines at 0.25/0.5/0.75/1.0 of max, plus baseline.
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map(t => Math.round(max * t));

  // Three x-axis labels: start, middle, end.
  const xLabelIndices =
    n === 1
      ? [0]
      : n === 2
        ? [0, 1]
        : [0, Math.floor(n / 2), n - 1];

  const formatLabel = (raw: string): string => {
    const d = new Date(raw.replace(' ', 'T') + 'Z');
    if (Number.isNaN(d.getTime())) return raw;
    if (unit === 'hour' || unit === 'minute') {
      return d.toLocaleTimeString('en-IN', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: false,
      });
    }
    if (unit === 'day') {
      return d.toLocaleDateString('en-IN', { month: 'short', day: 'numeric' });
    }
    return d.toLocaleDateString('en-IN', { month: 'short', year: '2-digit' });
  };

  return (
    <div className="w-full">
      <svg
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        preserveAspectRatio="none"
        className="h-60 w-full"
        role="img"
        aria-label="Activity over time"
      >
        <defs>
          <linearGradient id="pv-grad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={COLORS.pageviews} stopOpacity="0.35" />
            <stop offset="100%" stopColor={COLORS.pageviews} stopOpacity="0" />
          </linearGradient>
          <linearGradient id="ss-grad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={COLORS.sessions} stopOpacity="0.22" />
            <stop offset="100%" stopColor={COLORS.sessions} stopOpacity="0" />
          </linearGradient>
        </defs>

        {yTicks.map(t => {
          const y = yAt(t);
          return (
            <g key={`grid-${t}`}>
              <line
                x1={PAD.left}
                x2={VIEW_W - PAD.right}
                y1={y}
                y2={y}
                stroke={COLORS.grid}
                strokeDasharray={t === 0 ? '0' : '2 4'}
                strokeWidth={t === 0 ? 1 : 0.75}
              />
              <text
                x={PAD.left - 6}
                y={y + 3}
                textAnchor="end"
                fontSize="10"
                fill={COLORS.axis}
              >
                {t.toLocaleString('en-IN')}
              </text>
            </g>
          );
        })}

        <path d={areaPath(sessions)} fill="url(#ss-grad)" />
        <path
          d={linePath(sessions)}
          fill="none"
          stroke={COLORS.sessions}
          strokeWidth="1.5"
          vectorEffect="non-scaling-stroke"
        />

        <path d={areaPath(pageviews)} fill="url(#pv-grad)" />
        <path
          d={linePath(pageviews)}
          fill="none"
          stroke={COLORS.pageviews}
          strokeWidth="2"
          vectorEffect="non-scaling-stroke"
        />

        {xLabelIndices.map((i, idx) => {
          const px = xAt(i);
          const anchor =
            idx === 0
              ? 'start'
              : idx === xLabelIndices.length - 1
                ? 'end'
                : 'middle';
          return (
            <text
              key={`xl-${i}`}
              x={px}
              y={VIEW_H - 8}
              textAnchor={anchor}
              fontSize="10"
              fill={COLORS.axis}
            >
              {formatLabel(pageviews[i]?.x ?? '')}
            </text>
          );
        })}
      </svg>
    </div>
  );
}
