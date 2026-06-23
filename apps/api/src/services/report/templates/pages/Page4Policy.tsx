/**
 * Page 4 — Policy & regulatory context (plan §3.2 / §1.4). Renders the per-state
 * policy matrix the AOI intersects, reusing the policy-comparison dataset (every
 * cell individually sourced + dated). The National column is deliberately
 * dropped here — site-screening readers care about the state(s) they're in, not
 * the national baseline — so this page shows state jurisdictions only and
 * degrades to an explicit "unavailable" note when the AOI hits no seeded state
 * (decision D4). Policy is content, not computation — this page only displays
 * the resolved CompareResult.
 */

import type { ReactNode } from "react";

import type { Cell } from "../../../policy/compute";
import type { MetaDimension } from "../../../policy/query";
import type { PolicyContext } from "../../../analysis/policyContext";
import { formatDate } from "../format";
import { Page, Unavailable } from "../primitives";
import type { ReportModel } from "../../reportModel";

/** A state code → its upper-case code (compact column header). */
function jurisdictionLabel(code: string): string {
  return code.toUpperCase();
}

function dimLabel(d: MetaDimension): string {
  return d.unit ? `${d.label} (${d.unit})` : d.label;
}

/** Most-recent source citation across the row's cells (compact provenance). */
function rowSource(cells: (Cell | undefined)[]): string | null {
  for (const c of cells) {
    if (c?.source) {
      return c.policy_year ? `${c.source} · ${c.policy_year}` : c.source;
    }
  }
  return null;
}

function PolicyMatrix({
  policy,
  codes,
}: {
  policy: PolicyContext;
  /** Jurisdiction columns to render (National already filtered out). */
  codes: string[];
}) {
  const { compare } = policy;
  const rows: ReactNode[] = [];
  let lastCategory = "";

  for (const dim of compare.dimensions) {
    const perCode = compare.matrix[dim.key] ?? {};
    const cells = codes.map((code) => perCode[code]);
    // Skip a dimension nobody has a value for (keeps the page tight).
    if (cells.every((c) => !c || c.value == null)) continue;

    if (dim.category !== lastCategory) {
      lastCategory = dim.category;
      rows.push(
        <tr className="cat-row" key={`cat-${dim.category}`}>
          <td colSpan={codes.length + 1}>{dim.category.replace(/_/g, " ")}</td>
        </tr>,
      );
    }

    const src = rowSource(cells);
    rows.push(
      <tr key={dim.key}>
        <td>
          {dimLabel(dim)}
          {src ? <div className="src">{src}</div> : null}
        </td>
        {cells.map((c, i) => (
          <td className="num" key={codes[i]}>
            {c?.display ?? "—"}
          </td>
        ))}
      </tr>,
    );
  }

  return (
    <table className="tbl">
      <thead>
        <tr>
          <th>Dimension</th>
          {codes.map((code) => (
            <th className="num" key={code}>
              {jurisdictionLabel(code)}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>{rows}</tbody>
    </table>
  );
}

export function Page4Policy({ model }: { model: ReportModel }) {
  const policy = model.policy;

  if (!policy) {
    return (
      <Page kicker="Policy" title="Policy & regulatory context">
        <Unavailable label="Policy & regulatory context" />
        <p className="muted">
          State intersection or the policy dataset was unavailable for this run.
        </p>
      </Page>
    );
  }

  // National column dropped — render the intersected state jurisdictions only.
  const codes = policy.compare.jurisdictions.filter((c) => c !== "national");
  const states = codes.map((c) => c.toUpperCase());

  if (codes.length === 0) {
    return (
      <Page kicker="Policy" title="Policy & regulatory context">
        <Unavailable label="State policy & regulatory context" />
        <p className="muted">
          The AOI intersects no seeded state boundary, so no state-level policy
          is available for this run.
        </p>
      </Page>
    );
  }

  return (
    <Page kicker="Policy" title="Policy & regulatory context">
      <p className="lead">
        {states.join(", ")}
        {policy.asOf ? (
          <span className="muted"> · reviewed to {formatDate(policy.asOf)}</span>
        ) : null}
      </p>
      <PolicyMatrix policy={policy} codes={codes} />
      <p className="muted">
        Each value is individually sourced and dated in the WCE
        policy-comparison dataset; the most-recent citation is shown beneath each
        row. Blank cells are not-yet-seeded for that jurisdiction.
      </p>
    </Page>
  );
}
