/**
 * Page 6 — Methodology, sources, disclaimer & contact (plan §3.2). Closes the
 * report with the scoring methodology, data provenance, the "screening — not
 * bankable" disclaimer, the CECL contact card, and the self-identifying meta
 * colophon (plan §2.1: reportVersion / engineVersion / inputsHash) so any
 * exported PDF is reproducible and traceable.
 */

import { Fragment } from "react";

import {
  CONTACT,
  DATA_SOURCES,
  DISCLAIMER,
  SCORE_INTRO,
  SCORE_METHODOLOGY,
} from "../brand";
import { formatDate, formatDateTime } from "../format";
import { Card, Note, Page } from "../primitives";
import type { ReportModel } from "../../reportModel";

function ContactCard() {
  const rows: { label: string; value: string }[] = [
    ...CONTACT.emails.map((e, i) => ({
      label: i === 0 ? "Email" : "Alt. email",
      value: e,
    })),
    ...CONTACT.phones.map((p) => ({ label: "Phone", value: p })),
    { label: "Office", value: CONTACT.office },
  ];
  return (
    <div className="contact">
      <p className="card-title">{CONTACT.shortName}</p>
      <p>{CONTACT.legalName}</p>
      <dl>
        {rows.map((r) => (
          <Fragment key={`${r.label}:${r.value}`}>
            <dt>{r.label}</dt>
            <dd>{r.value}</dd>
          </Fragment>
        ))}
      </dl>
    </div>
  );
}

function Colophon({ meta }: { meta: ReportModel["meta"] }) {
  return (
    <div className="colophon">
      <p className="card-title">Report provenance</p>
      <dl>
        <dt>Generated</dt>
        <dd>{formatDateTime(meta.generatedAt)}</dd>
        <dt>Report layout</dt>
        <dd>v{meta.reportVersion}</dd>
        <dt>Analysis engine</dt>
        <dd>v{meta.engineVersion}</dd>
        <dt>Model schema</dt>
        <dd>v{meta.modelSchemaVersion}</dd>
        <dt>Policy reviewed to</dt>
        <dd>{meta.policyAsOf ? formatDate(meta.policyAsOf) : "—"}</dd>
        <dt>Inputs hash</dt>
        <dd>{meta.inputsHash}</dd>
      </dl>
    </div>
  );
}

export function Page6Disclaimer({ model }: { model: ReportModel }) {
  return (
    <Page kicker="Methodology & disclaimer" title="How to read this report">
      <Card title="Screening score methodology">
        <p className="muted">{SCORE_INTRO}</p>
        <ul className="tight">
          {SCORE_METHODOLOGY.map((m) => (
            <li key={m.label}>
              <strong>{m.label}</strong>{" "}
              <span className="muted">· weight {m.weight}</span>
              <div className="muted">{m.text}</div>
            </li>
          ))}
        </ul>
      </Card>

      <Card title="Data sources & attribution">
        <ul className="tight muted">
          {DATA_SOURCES.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ul>
      </Card>

      <Note warn>{DISCLAIMER}</Note>

      <ContactCard />

      <Colophon meta={model.meta} />
    </Page>
  );
}
