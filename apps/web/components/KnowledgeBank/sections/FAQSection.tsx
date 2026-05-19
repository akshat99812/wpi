"use client";

import React from 'react';
import type { WpiBundle } from '@/lib/types';
import { InfoCard, Prose, SectionHeader } from '../WindCards';

interface Props {
  bundle?:        WpiBundle;
  selectedState?: string | null;
}

const QuestionIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
       strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <circle cx="12" cy="12" r="9" />
    <path d="M9.5 9a2.5 2.5 0 1 1 4 2.5c-.6.4-1.5 1-1.5 2" />
    <line x1="12" y1="17" x2="12.01" y2="17" />
  </svg>
);

interface FAQ {
  q:        string;
  defaultOpen?: boolean;
  accent?:  string;
  body:     React.ReactNode;
}

// FAQ accent palette — recycles the section palette used elsewhere so the
// tab looks of-a-piece with the rest of the Knowledge Bank.
const ORANGE = '#ff8a1f';
const CYAN   = '#7bc4e2';
const GREEN  = '#4cc87a';

const FAQS: FAQ[] = [
  {
    q: 'Where does the data on this portal come from?',
    defaultOpen: true,
    accent: ORANGE,
    body: (
      <>
        <Prose>
          Every figure is anchored to a public source. National wind installed
          capacity is scraped from the{' '}
          <b className="text-[#ffd0a0]">MNRE Physical Progress</b> page (monthly
          report, plus the annual RE-Statistics bulletin as fallback). Onshore
          150 m wind potential comes from the{' '}
          <b className="text-[#ffd0a0]">NIWE 2021 Wind Atlas</b>.
        </Prose>
        <Prose>
          Auction outcomes and L1 tariffs are pulled from{' '}
          <b className="text-[#ffd0a0]">SECI</b>, cross-checked against Mercom
          India, Renewable Watch and Solar Quarter. State news is aggregated
          from <b className="text-[#ffd0a0]">Google News</b> per state; editorial
          coverage comes from ET EnergyWorld, PV Magazine, Business Standard,
          Saur Energy and EQ Magazine.
        </Prose>
      </>
    ),
  },
  {
    q: 'How often is the data refreshed?',
    accent: GREEN,
    body: (
      <>
        <Prose>
          A daily orchestrator runs on the API server, but each source has its
          own cache window. MNRE Physical Progress is re-fetched at most every
          90 days (the underlying PDF only changes monthly). NIWE wind-overview
          refreshes once a year. State-specific Google News is cached 30 minutes
          per state. Auctions, tariffs and policy headlines are pulled on every
          daily run.
        </Prose>
        <Prose>
          The &ldquo;Live&rdquo; pill in each tab header signals that the section is
          backed by the orchestrator&apos;s latest bundle, not a hardcoded
          fixture.
        </Prose>
      </>
    ),
  },
  {
    q: 'Why does the installed-capacity figure here differ from other trackers?',
    accent: ORANGE,
    body: (
      <>
        <Prose>
          The delta usually traces to the <i>as-on</i> date. MNRE publishes
          two relevant reports: a monthly <b className="text-[#ffd0a0]">
          State-wise RE Installed Capacity</b> file (current to within ~30
          days) and the annual <b className="text-[#ffd0a0]">RE-Statistics</b>{' '}
          bulletin (~12 months stale by the time it lands each November).
        </Prose>
        <Prose>
          This dashboard reads from the monthly file via the Physical
          Achievements table — so the installed figure here is the most
          current MNRE figure. When numbers disagree, MNRE Physical Progress is
          the source of record.
        </Prose>
      </>
    ),
  },
  {
    q: 'What does "150 m potential" actually mean?',
    accent: CYAN,
    body: (
      <Prose>
        NIWE&apos;s 2021 assessment reran India&apos;s onshore wind-resource
        model at <b className="text-[#ffd0a0]">150 m hub height</b> instead of
        the 100 m baseline used by earlier atlases. Taller towers reach a
        higher-wind-speed layer with smoother seasonal profiles, which is why
        the national potential jumped from ~302 GW @ 100 m to{' '}
        <b className="text-[#ffd0a0]">1,163.9 GW @ 150 m</b>. The figure is
        gross technical potential — not all of it is bankable or
        evacuation-ready today.
      </Prose>
    ),
  },
  {
    q: 'What does ALMM mean?',
    accent: ORANGE,
    body: (
      <Prose>
        <b className="text-[#ffd0a0]">ALMM</b> — the Approved List of Models &amp;
        Manufacturers — is MNRE&apos;s roster of wind-turbine models eligible
        for central renewable schemes. The wind ALMM is published as a PDF
        on mnre.gov.in and is linked directly from the Technology tab of this
        portal.
      </Prose>
    ),
  },
  {
    q: 'How are auction tariffs reported here?',
    accent: GREEN,
    body: (
      <Prose>
        We report the <b className="text-[#ffd0a0]">L1 discovered tariff</b>{' '}
        for SECI / state-utility wind auctions — that is, the lowest winning
        bid, in ₹/kWh, on the day of bid opening. Subsequent PPA tariffs may
        differ if a tariff-adoption petition reshapes the price after the bid;
        those are captured separately on the Tariffs tab when they materialise.
      </Prose>
    ),
  },
  {
    q: 'How do Geospatial, Finance and Research differ?',
    accent: CYAN,
    body: (
      <Prose>
        <b className="text-[#ffd0a0]">Geospatial</b> (this page) is the
        state-by-state map of capacity, tariffs, policy, grid and news.{' '}
        <b className="text-[#ffd0a0]">Finance</b> is a project-level DCF model
        with bankability scoring and lender criteria — useful when sizing one
        specific asset. <b className="text-[#ffd0a0]">Research</b> is an
        11-section reading bench covering wind regime, technology, regulation
        and supply chain, with AI search across the MNRE / NIWE / CEA corpus.
      </Prose>
    ),
  },
  {
    q: 'How do I report a data issue or request a feature?',
    accent: ORANGE,
    body: (
      <Prose>
        The portal is built and maintained by{' '}
        <b className="text-[#ffd0a0]">Consolidated Energy Consultants Ltd.
        (CECL)</b>, est. 1986. For data corrections, missing states, new sources
        or partnership conversations, reach the CECL team at{' '}
        <a href="https://cecl.in"
           target="_blank" rel="noopener noreferrer"
           className="text-orange/90 hover:text-orange underline-offset-2 hover:underline">
          cecl.in
        </a>.
      </Prose>
    ),
  },
];

export default function FAQSection({ bundle: _bundle }: Props) {
  return (
    <div className="flex flex-col gap-3.5">
      <SectionHeader
        eyebrow="Frequently Asked"
        title="FAQ"
        live={false}
        delay={0}
      />

      {FAQS.map((f, i) => (
        <InfoCard
          key={i}
          title={f.q}
          defaultOpen={!!f.defaultOpen}
          delay={60 + i * 40}
          icon={<QuestionIcon />}
          accent={f.accent ?? ORANGE}
        >
          {f.body}
        </InfoCard>
      ))}
    </div>
  );
}
