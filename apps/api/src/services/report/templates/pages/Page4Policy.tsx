/**
 * Page 4 — Policy & regulatory context (plan §3.2 / §1.4). Renders the national
 * + per-state policy matrix the AOI intersects, reusing the policy-comparison
 * dataset (every cell individually sourced + dated). Degrades to national-only
 * or an explicit "unavailable" note (decision D4). Policy is content, not
 * computation — this page only displays the resolved CompareResult.
 */

import type { ReactNode } from "react";

import type { Cell } from "../../../policy/compute";
import type { MetaDimension } from "../../../policy/query";
import type { PolicyContext } from "../../../analysis/policyContext";
import { formatDate } from "../format";
import { Page, Unavailable } from "../primitives";
import type { ReportModel } from "../../reportModel";

/** "national" → "National"; a state code → its upper-case code (compact header). */
function jurisdictionLabel(code: string): string {
  return code === "national" ? "National" : code.toUpperCase();
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

function PolicyMatrix({ policy }: { policy: PolicyContext }) {
  const { compare } = policy;
  const codes = compare.jurisdictions;
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

  const states = policy.stateCodes.map((c) => c.toUpperCase());
  const scope =
    states.length > 0 ? `National + ${states.join(", ")}` : "National only";

  return (
    <Page kicker="Policy" title="Policy & regulatory context">
      <p className="lead">
        {scope}
        {policy.asOf ? (
          <span className="muted"> · reviewed to {formatDate(policy.asOf)}</span>
        ) : null}
      </p>
      {states.length === 0 ? (
        <p className="muted">
          The AOI intersects no seeded state boundary — showing national policy
          only.
        </p>
      ) : null}
      <PolicyMatrix policy={policy} />
      <p className="muted">
        Each value is individually sourced and dated in the WCE
        policy-comparison dataset; the most-recent citation is shown beneath each
        row. Blank cells are not-yet-seeded for that jurisdiction.
      </p>
    </Page>
  );
}
