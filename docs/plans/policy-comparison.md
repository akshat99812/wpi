# Implementation Plan — Wind Policy Comparison (WCE)

> Status: **BUILT + verified end-to-end 2026-06-21** (uncommitted). P1–P7 done; 224 sourced
> policy_value rows loaded; only the logged-in browser screenshot is unrun (needs a Pro account password).
> Branch base: `main`. Feature branch suggestion: `feat/policy-comparison`.
> Companion to the feature spec. Where this plan deviates from the spec, it is **flagged** (the spec requires that).

---

## 0. The one thing that shapes everything

**Engineering and data are decoupled.** The schema, API, and UI are deterministic and can be built correctly today. The *policy values* are the legally-sensitive part and are **not in the repo** — they live in SERC tariff orders, state wind/RE policy GRs, GEOA Rules 2022, and the MoP/BEE national notification. They must each carry a real citation.

Decisions confirmed with the user:
- **Sourcing:** I research **primary sources** (SERC / MNRE / MoP / state energy-dept docs), store the exact `raw_excerpt` + `source_url` per cell, mark `confidence='extracted'`, and flag anything not pinnable to an official doc. User verifies before flipping to `'verified'`.
- **UI bar:** **Show all + confidence badge** (verified / extracted / estimated all render, each with a visible badge + source on hover).

A primary-source reconnaissance pass already ran (see **§7 Source coverage map**). It proved every dimension is sourceable to a real document for most jurisdictions, *and* the verification sub-pass caught three stale/wrong values — evidence the provenance protocol works and is necessary.

---

## 1. Critical findings from reconnaissance (read before building)

1. **The existing "policy" JSON is mock data — quarantine it.** `apps/api/data/by-source/state_serc.json` and `state_nodal.json` carry `"fixturesUsed": true` and placeholder tariffs (e.g. ₹3.78). The loader **must not** read these. They are exactly the adhoc data we are forbidding.

2. **The RAG corpus is the wrong corpus.** The *Indian Windpower Directory 2025* is installation **statistics**, not regulatory orders. The §4 dimensions are not in it. → The spec's §7 "if PDFs, reuse Docling" branch does **not** apply; we use the **web-research → typed-extraction** path instead.

3. **Several "numeric" dimensions are rules, not numbers.** e.g. Tamil Nadu `wheeling_charge` = "50% of the conventional wheeling charge in the prevailing TANGEDCO order", and `transmission_loss` is levied "in kind", with no fixed ₹/kWh or %. This **breaks the spec's rule** that a numeric dimension stores only `value_numeric`. → **Flagged deviation, §3.4.**

4. **RPO is now RCO at the national level.** The national `rpo_wind`/`rpo_total` trajectory comes from **MoP RCO Notification S.O. 4421(E) dated 27 Sep 2025** (superseding the 20 Oct 2023 notification), operationalised by the **BEE RCO Operational Guidelines**. Keep the dimension *keys* (`rpo_wind`, `rpo_total`) — they're an API contract — but the label/description should note "now termed Renewable Consumption Obligation (RCO)".

5. **State polygons:** `wce.admin_state` exists (migration 003) but is populated only from a separate Survey-of-India download that may be absent locally. The reliable geom source is the always-present cache `apps/api/data/cache/india_states.geojson` (property `ST_NM` = full state name). Seed `jurisdiction.geom` from that file, with a name→`state_code` map.

---

## 2. Architecture & integration points (grounded in this codebase)

| Concern | Decision | Evidence |
|---|---|---|
| Schema | New tables in the existing **`wce`** schema (not public). | `wce.*` established in `003_exclusions.sql` |
| Migration | `apps/api/migrations/004_policy_comparison.sql`. Apply by hand (no npm migrate) per the docker pattern documented in 003's header: `docker exec -i <postgis-container> psql -U wpi -d wpi < apps/api/migrations/004_policy_comparison.sql`. Use `CREATE TABLE IF NOT EXISTS` so re-runs are safe. | `003_exclusions.sql` header |
| DB access | `import { pool, dbAvailable } from "../lib/db"` (route) / `"../src/lib/db"` (script). `pg` pool on `DATABASE_URL`. | `apps/api/src/lib/db.ts` |
| Routes | `apps/api/src/routes/policy.ts`, mounted `app.use('/api', policyRoutes)` in `server.ts` (add import + one `app.use` line in the existing mount block). | `server.ts` mount block |
| Gating | **Pro-gate** the routes with `...requirePro` (same as windmills/analyze/boundaries — all Pro data is gated). Frontend page gates via `useSession()` tier check (`user?.tier === 'PREMIUM'`), mirroring the chat/pro-map pages. | `middleware/requirePro.ts`, chat page |
| Rate limit | Reuse the `express-rate-limit` `detailLimiter` pattern; keyGenerator `req.user?.id \|\| req.ip \|\| "anon"`. | `routes/turbines.ts` |
| Validation | Validate query params against an allowlist + types (reject unknown → 400), matching `exclusions.ts`/`powerTiles.ts`. `zod` is **not** a dep here — use hand validation consistent with existing routes. | route conventions |
| Geom out | `ST_AsGeoJSON(geom)` per feature, wrapped into a `FeatureCollection` in the handler (inverse of the `ST_GeomFromGeoJSON` ingest already used). | `services/exclusions/loader.ts` |
| Errors | `{ error: string }` (+ optional `code`); `console.error("[policy/...] …")`; `dbAvailable()` 503 guard **first**. | route conventions |
| Frontend route | `apps/web/app/(portal)/policy/page.tsx` — inherits portal chrome (TopBar, dark theme). `"use client"`. | portal layout |
| API base | `const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001"`; vanilla `fetch` with `credentials: "include"`. No SWR/react-query. | chat page |
| Design tokens | CSS vars in `globals.css`: `--bg:#0b0f19`, `--panel:#131826`, `--border:#27324a`, `--text:#e8ecf4`, `--muted:#9aa4ba`, `--orange:#ff8a1f`. No component lib — build custom Tailwind components (popover ≈ CSS or tiny Floating UI). | `globals.css` |
| Choropleth | Recolor state polygons with a MapLibre **fill** layer using an `interpolate`/`['get','value']` paint expression (same shape as `elevationTint`/`powerGrid`); separate source from `useStateBoundaries`; insert fill **before** the boundary line; legend like `CapacityLegend.tsx`. | Map utils |

---

## 3. Data model

### 3.1 Tables (per spec §3, placed in `wce`)
`wce.jurisdiction`, `wce.policy_dimension`, `wce.policy_value` — columns exactly as the spec. Indexes as the spec. `policy_value` UNIQUE `(jurisdiction_id, dimension_id, policy_year)`.

### 3.2 Seed — dimensions (§4 taxonomy)
24 rows, idempotent `INSERT … ON CONFLICT (key) DO UPDATE`. `sort_order` +10 within category. Category render order: `pricing → open_access → charges → banking → rpo → dispatch → repowering → land → incentives → clearances`. Enum sets as spec.

### 3.3 Seed — jurisdictions
`India (National)` + **TN, GJ, KA, RJ, MH, KL, AP, MP** (8 states). Geom from `india_states.geojson` via `ST_Multi(ST_GeomFromGeoJSON(...))` SRID 4326; National geom NULL. Name→code map: Tamil Nadu→TN, Gujarat→GJ, Karnataka→KA, Rajasthan→RJ, Maharashtra→MH, Kerala→KL, Andhra Pradesh→AP, Madhya Pradesh→MP.

### 3.4 ⚠️ FLAGGED DEVIATION — "rule, not a number" cells
The spec says a numeric dimension populates only `value_numeric`. Reality: some numeric dimensions are expressed as a **rule** (TN `wheeling_charge` = "50% of conventional charge"; "in-kind" losses). Rendering these grey ("silent") would be **wrong** — the state *does* have a policy.

**Proposed handling:** a cell for a numeric dimension may carry `value_numeric` **OR**, when the policy is rule-based, `value_text` (the rule) — never both. The loader enforces "exactly one value column". Display: number → formatted with unit; rule-text → shown verbatim, neutral styling, **excluded from choropleth** (choropleth selects only `value_numeric IS NOT NULL`). The API cell gains an optional `"basis": "rule"` marker so the UI styles it distinctly from a true missing/grey cell. **This needs your sign-off** before I build it.

---

## 4. Provenance & legal-accuracy protocol (the heart of "no adhoc data")

Every `policy_value` row is inserted **only** through a typed-extraction record that carries: `value`, `unit`, `raw_excerpt` (verbatim from the doc), `source_name`, `source_url`, `policy_year`, `confidence`. Hard gate: **no `raw_excerpt` + no `source_url` ⇒ the row is not written.** The loader rejects such records loudly (fail-fast), it does not silently skip.

Pipeline:
1. **Research** (already piloted) → one structured record per (jurisdiction, dimension) into `db/seed/policy_data/<code>.json` — a reviewable, version-controlled artifact, **not** values hardcoded in TS.
2. **Adversarial verify** — each numeric/boolean claim checked against a *second* primary source; verdict `confirmed | refuted | uncertain`. `refuted`/`uncertain` are not written as fact until resolved.
3. **Human verify** — you review the JSON; flip `confidence` to `'verified'` where confirmed against the source PDF.
4. **Load** — `db/seed/policy_seed.ts` upserts from the JSON files, enforcing the one-value-column + provenance rules.

`as_of_date` stamped at load. Re-running is idempotent (UNIQUE key). Caveat field on every cell notes "SERC orders are revised periodically — see source order's effective period."

The recon's verification stage already caught: **KA** `preferential_tariff` ₹3.60→₹3.24 (FY26 order); **MH** `banking_period` annual→**monthly** (2023 DOA amendment supersedes 2016); **AP** `banking_charge` 12% peak component was draft-only, removed in final order. These are exactly why the protocol exists.

---

## 5. API contract (per spec §5) — build order

1. `GET /api/policy/meta` → `{ jurisdictions[], dimensions[] }`.
2. `GET /api/policy/compare` — both modes:
   - `?jurisdictions=national,TN,GJ&year=2024` (plain)
   - `?base=national&targets=TN,GJ&year=2024` (diff)
   - Pivot `matrix[dimension][code] = { value, display, raw, source, source_url, policy_year, confidence, basis?, diff? }`.
   - **Diff computed server-side only** (spec §5.3): numeric `delta`/`no_baseline`; boolean/enum `aligned|differs|state_silent|no_baseline`; text → `{kind:"text"}`. Default `year` = latest available per cell.
3. `GET /api/policy/choropleth?dimension=<key>&year=<y>` → GeoJSON FC of state geom + `{value, display}`; **400 for non-numeric** dimensions; only emits states with `value_numeric IS NOT NULL`.

`display` formatting (₹/kWh, %, kW, years, booleans → Yes/No, enums → label) computed server-side so the UI renders verbatim.

## 6. Phased build sequence (tasks)

- **P1 — Migration.** `004_policy_comparison.sql` (3 tables + indexes, `wce` schema). Apply, verify with `\d wce.policy_value`.
- **P2 — Seed structure.** `policy_seed.ts`: dimensions (24) + jurisdictions (9, geom from geojson). Idempotent. Verify counts + geom not null for 8 states.
- **P3 — Data files + loader.** Land per-jurisdiction JSON (from §7 recon, expanded), then load. Provenance gate enforced. (RJ & MP need their verify pass re-run — it hit a session limit.)
- **P4 — API.** `/meta` → `/compare` (both modes + diff) → `/choropleth`. Pro-gated, rate-limited, validated.
- **P5 — Frontend.** `JurisdictionPicker` + `PolicyMatrix` (sticky first col, category sections, diff tints: aligned=green, differs=amber, silent/absent=grey, text/no-baseline=neutral; popover with excerpt/source/year/confidence badge). Mobile: `overflow-x-auto` + pinned first column.
- **P6 — Choropleth.** `DimensionChoropleth` numeric-dimension dropdown → recolor + legend.
- **P7 — Polish & verify.** Acceptance criteria §9; confidence badges; grey-vs-rule distinction; year selector; E2E with Playwright.

Tests (per project rules, 80%+): unit (diff semantics, display formatting, loader provenance gate, one-value-column enforcement), integration (each endpoint incl. non-numeric choropleth 400, missing-cell grey), E2E (compare + diff render, popover sources, choropleth recolor).

## 7. Source coverage map (from reconnaissance)

Full structured output: `tasks/wy3mgfppn.output` (`.result.policySourceMaps`). Per-jurisdiction sourced dimensions / unresolved:

| Jurisdiction | Sourced | Unresolved (genuinely silent or unpinned) | Verify |
|---|---|---|---|
| India (National) | 12 | state-set dims (wheeling, css_applicable, etc.) — correctly silent | 12 ✓ |
| Tamil Nadu | 21 | wheeling_charge*, transmission_loss*, gram_panchayat_noc, electricity_duty_exemption, green_energy_cess, preferential_tariff(→bidding) | 20✓ 1 uncertain |
| Gujarat | 22 | green_energy_cess, gram_panchayat_noc | 21✓ 1 uncertain |
| Karnataka | 23 | wheeling_charge, green_energy_cess | 20✓ **1 refuted** 2 uncertain |
| Rajasthan | 24 | preferential_tariff | ⚠ verify not run (session limit) |
| Maharashtra | 23 | preferential_tariff, green_energy_cess | 22✓ **1 refuted** (banking_period) |
| Kerala | 18 | wheeling_charge, wheeling_concession, css_concession, additional_surcharge, transmission_loss, green_energy_cess | 18 ✓ |
| Andhra Pradesh | 22 | green_energy_cess, gram_panchayat_noc | 21✓ **1 refuted** (banking_charge) |
| Madhya Pradesh | 24 | preferential_tariff, gram_panchayat_noc | ⚠ verify not run (session limit) |

\* rule-based, not a fixed number (see §3.4). National backbone: GEOA Rules 2022 (gazette 6 Jun 2022), MoP RCO S.O. 4421(E) (27 Sep 2025) + BEE RCO Guidelines, MNRE Repowering & Life Extension Policy 2023 (7 Dec 2023), CERC IEGC 2023 (must-run).

## 8. Open questions / risks

1. **§3.4 rule-vs-number deviation** — approve the `value_text`-on-numeric + `basis:"rule"` approach? (Blocks final schema.)
2. **Year baseline** — orders have different effective dates; `policy_year` per cell + "latest ≤ selected year" resolution. Confirm UI year set (e.g. 2024/2025).
3. **Re-verify RJ + MP** (session-limit gap) before their values are treated as anything above `extracted`.
4. **Refuted values** (KA tariff, MH banking, AP banking) must be corrected to the verified figure before load.
5. **Source-link rot** — some recon URLs are mirrors (e.g. manikaranpowerltd, eqmagpro) not the SERC's own site. During P3, prefer the issuing authority's canonical URL; keep mirror as fallback.
