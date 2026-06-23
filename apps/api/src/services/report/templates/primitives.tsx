/**
 * Shared presentational primitives for the print pages (plan §3.2). Pure
 * props → JSX, SSR via renderToStaticMarkup — no DOM, no hooks, no state. The
 * pages compose these so layout/markup stays consistent and the page files stay
 * focused on which model slice goes where.
 */

import type { ReactNode } from "react";

import type { SiteClass } from "../../analysis/types";

/** One logical report page (breaks after via .page CSS). */
export function Page({
  kicker,
  title,
  children,
}: {
  kicker: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="page">
      <header>
        <p className="page-kicker">{kicker}</p>
        <h1 className="page-title">{title}</h1>
      </header>
      {children}
    </section>
  );
}

/** Titled container card. */
export function Card({
  title,
  children,
}: {
  title?: string;
  children: ReactNode;
}) {
  return (
    <div className="card">
      {title ? <p className="card-title">{title}</p> : null}
      {children}
    </div>
  );
}

/** Single label/value/sub stat cell (mirrors the live Stat). */
export function Stat({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="stat">
      <p className="stat-label">{label}</p>
      <p className="stat-value">{value}</p>
      {sub ? <p className="stat-sub">{sub}</p> : null}
    </div>
  );
}

/** Responsive stat grid (2 or 3 columns). */
export function StatGrid({
  cols = 2,
  children,
}: {
  cols?: 2 | 3;
  children: ReactNode;
}) {
  return <div className={`grid grid-${cols}`}>{children}</div>;
}

/** A figure frame around an SVG chart, with caption. */
export function Figure({
  title,
  caption,
  children,
}: {
  title?: string;
  caption?: string;
  children: ReactNode;
}) {
  return (
    <div className="figure">
      {title ? <p className="card-title">{title}</p> : null}
      {children}
      {caption ? <p className="figure-cap">{caption}</p> : null}
    </div>
  );
}

const BAND_CLASS: Record<SiteClass, string> = {
  excellent: "badge--excellent",
  good: "badge--good",
  moderate: "badge--moderate",
  marginal: "badge--marginal",
};

/** Site-class-coloured pill. `variant` keys the band palette. */
export function Badge({
  variant,
  children,
}: {
  variant?: SiteClass;
  children: ReactNode;
}) {
  const cls = variant ? ` ${BAND_CLASS[variant]}` : "";
  return <span className={`badge${cls}`}>{children}</span>;
}

/** Explicit "section unavailable for this run" placeholder (never an empty hole). */
export function Unavailable({ label }: { label: string }) {
  return <div className="unavailable">{label}: unavailable for this run.</div>;
}

/** Callout note; `warn` switches to the amber "indicative / placeholder" style. */
export function Note({
  warn = false,
  children,
}: {
  warn?: boolean;
  children: ReactNode;
}) {
  return <div className={warn ? "note note--warn" : "note"}>{children}</div>;
}

/**
 * A captured map image (data URL) framed with its caption. A failed/missing
 * shot renders an explicit placeholder rather than a broken <img> (plan §4
 * senior note: skip-and-placeholder, never fail the whole export).
 */
export function MapFrame({
  src,
  caption,
}: {
  src: string | null;
  caption: string;
}) {
  return (
    <figure className="map">
      {src ? (
        <img src={src} alt={caption} />
      ) : (
        <div className="map-missing">map image unavailable</div>
      )}
      <figcaption className="map-cap">{caption}</figcaption>
    </figure>
  );
}
