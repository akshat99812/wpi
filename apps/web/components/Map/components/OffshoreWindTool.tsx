import React from 'react';
import Link from 'next/link';
import type {
  OffshoreData,
  OffshoreZoneProps,
  OffshoreProjectProps,
  OffshorePolicyItem,
} from '../utils/offshoreWind';
import { OFFSHORE_ZONE_COLOR, OFFSHORE_PROJECT_COLOR } from '../utils/offshoreWind';

/**
 * "Offshore wind" — Pro-map sidebar tool. Surfaces India's offshore wind
 * picture: NIWE/FOWIND-identified zones, VGF/LiDAR project sites, and the
 * national policy block (Offshore Wind Energy Policy 2015, the 30 GW-by-2030
 * target, the 2024 VGF scheme), each with a source link.
 *
 * The overview renders from the one `/api/offshore-wind` fetch, so it's useful
 * even with the map layer toggled off. Clicking a zone or project on the map
 * pins its detail to the top of the panel.
 */

export const OffshoreIcon = ({ className = '' }: { className?: string }) => (
  <svg
    viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"
    className={className} aria-hidden
  >
    {/* offshore turbine over waves: rotor + mast rising from a wavy sea line */}
    <circle cx="12" cy="5" r="1.1" />
    <path d="M12 6.1V14" />
    <path d="M12 5l3.4 2M12 5L8.6 7" />
    <path d="M3 18c1.6-1.1 3.1-1.1 4.7 0s3.1 1.1 4.7 0 3.1-1.1 4.7 0" />
    <path d="M3 21c1.6-1.1 3.1-1.1 4.7 0s3.1 1.1 4.7 0 3.1-1.1 4.7 0" />
  </svg>
);

interface Props {
  data: OffshoreData | null;
  selectedZone: OffshoreZoneProps | null;
  selectedProject: OffshoreProjectProps | null;
  loading: boolean;
  error: string | null;
}

const gw = (v: number | null) => (v != null ? `~${v} GW` : '—');
const mw = (v: number | null) => (v != null ? `${v} MW` : '—');

export function OffshoreWindTool({
  data,
  selectedZone,
  selectedProject,
  loading,
  error,
}: Props) {
  if (loading && !data) {
    return <p className="px-4 py-4 text-sm text-slate-300">Loading offshore data…</p>;
  }
  if (error && !data) {
    return <p className="px-4 py-4 text-sm text-rose-300">{error}</p>;
  }
  if (!data) {
    return <EmptyState />;
  }

  return (
    <div className="px-4 py-4">
      {/* ── Header ── */}
      <header>
        <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-cyan-400/80">
          Offshore wind · India
        </p>
        <h3 className="mt-1 text-lg font-semibold leading-tight tracking-tight text-white">
          Zones, projects &amp; policy
        </h3>
      </header>

      {/* ── Clicked-feature detail (pinned to top) ── */}
      {selectedZone && <ZoneDetail zone={selectedZone} />}
      {selectedProject && <ProjectDetail project={selectedProject} />}

      {/* ── Zones ── */}
      {data.zones.length > 0 && (
        <Section title="Identified zones" swatch={OFFSHORE_ZONE_COLOR}>
          <ul className="space-y-2">
            {data.zones.map((z) => (
              <li key={z.id} className="text-sm">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-medium text-slate-100">{z.name}</span>
                  <span className="shrink-0 font-mono text-xs tabular-nums text-cyan-300">
                    {gw(z.potential_gw)}
                  </span>
                </div>
                <p className="text-xs text-slate-400">
                  {[z.state, z.status].filter(Boolean).join(' · ')}
                </p>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {/* ── Projects ── */}
      {data.projects.length > 0 && (
        <Section title="Projects & surveys" swatch={OFFSHORE_PROJECT_COLOR}>
          <ul className="space-y-2">
            {data.projects.map((p) => (
              <li key={p.id} className="text-sm">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-medium text-slate-100">{p.name}</span>
                  <span className="shrink-0 font-mono text-xs tabular-nums text-orange-300">
                    {mw(p.capacity_mw)}
                  </span>
                </div>
                <p className="text-xs text-slate-400">
                  {[p.state, p.type, p.status].filter(Boolean).join(' · ')}
                </p>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {/* ── Policy ── */}
      {data.policy.length > 0 && (
        <Section title="National policy">
          <div className="divide-y divide-slate-800">
            {data.policy.map((item) => (
              <PolicyRow key={item.key} item={item} />
            ))}
          </div>
        </Section>
      )}

      {/* ── Footer: portal link + provenance ── */}
      <div className="mt-4 border-t border-slate-800 pt-3">
        <Link
          href="/research/policy?jurisdiction=national"
          className="inline-flex items-center gap-1 text-[11px] font-medium text-sky-400 hover:text-sky-300"
        >
          Full wind-policy comparison →
        </Link>
        <p className="mt-2 text-[10px] leading-relaxed text-slate-500">
          Zone outlines are indicative (orientation only), not survey or lease
          boundaries. Verify with MNRE / NIWE before commercial use.
        </p>
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-6 py-10 text-center">
      <OffshoreIcon className="h-8 w-8 text-slate-600" />
      <p className="text-sm text-slate-400">
        Offshore wind data is unavailable right now.
      </p>
    </div>
  );
}

function ZoneDetail({ zone }: { zone: OffshoreZoneProps }) {
  return (
    <DetailCard
      tag="Zone"
      tagClass="border-cyan-400/30 bg-cyan-400/10 text-cyan-300"
      title={zone.name}
      subtitle={[zone.state, zone.status].filter(Boolean).join(' · ')}
    >
      <dl className="divide-y divide-slate-800 text-sm">
        <Row label="Potential" value={gw(zone.potential_gw)} />
        <Row label="State" value={zone.state || '—'} />
      </dl>
      {zone.note && <Note text={zone.note} />}
    </DetailCard>
  );
}

function ProjectDetail({ project }: { project: OffshoreProjectProps }) {
  return (
    <DetailCard
      tag="Project"
      tagClass="border-orange-400/30 bg-orange-400/10 text-orange-300"
      title={project.name}
      subtitle={[project.state, project.type].filter(Boolean).join(' · ')}
    >
      <dl className="divide-y divide-slate-800 text-sm">
        <Row label="Capacity" value={mw(project.capacity_mw)} />
        <Row label="Status" value={project.status || '—'} />
        <Row label="Year" value={project.year != null ? String(project.year) : '—'} />
      </dl>
      {project.note && <Note text={project.note} />}
    </DetailCard>
  );
}

function DetailCard({
  tag,
  tagClass,
  title,
  subtitle,
  children,
}: {
  tag: string;
  tagClass: string;
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mt-3 rounded-lg border border-slate-700/60 bg-slate-800/40 px-3 py-3">
      <p className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-300/80">
        Selected
        <span className={`rounded border px-1.5 py-0.5 text-[9px] font-bold tracking-wider ${tagClass}`}>
          {tag}
        </span>
      </p>
      <h4 className="mt-1 text-base font-semibold leading-tight text-white">{title}</h4>
      {subtitle && <p className="mt-0.5 text-xs text-slate-400">{subtitle}</p>}
      <div className="mt-2">{children}</div>
    </div>
  );
}

function Section({
  title,
  swatch,
  children,
}: {
  title: string;
  swatch?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-4">
      <p className="flex items-center gap-2 pb-2 font-mono text-[10px] uppercase tracking-[0.18em] text-slate-500">
        {swatch && (
          <span
            className="h-2.5 w-2.5 shrink-0 rounded-sm"
            style={{ backgroundColor: swatch }}
          />
        )}
        {title}
      </p>
      {children}
    </section>
  );
}

/** Only render a link for plain http(s) URLs — never javascript:/data: etc.,
 *  even if a malformed source_url ever lands in the data file. */
const isSafeUrl = (url: string) => /^https?:\/\//i.test(url);

function PolicyRow({ item }: { item: OffshorePolicyItem }) {
  return (
    <div className="py-2.5 first:pt-0">
      <div className="flex items-baseline justify-between gap-2">
        <dt className="text-sm font-medium text-slate-200">{item.label}</dt>
        <dd className="shrink-0 text-right font-mono text-xs tabular-nums text-slate-100">
          {item.value}
        </dd>
      </div>
      {item.detail && (
        <p className="mt-1 text-[11px] leading-snug text-slate-400">{item.detail}</p>
      )}
      {item.source_url && isSafeUrl(item.source_url) && (
        <a
          href={item.source_url}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-1 inline-flex items-center gap-1 text-[10px] text-sky-400 hover:text-sky-300"
        >
          {item.source_name || 'Source'} ↗
        </a>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5">
      <dt className="shrink-0 text-slate-400">{label}</dt>
      <dd className="text-right font-medium tabular-nums text-slate-100">{value || '—'}</dd>
    </div>
  );
}

function Note({ text }: { text: string }) {
  return (
    <p className="mt-2 text-[11px] leading-snug text-slate-400">{text}</p>
  );
}
