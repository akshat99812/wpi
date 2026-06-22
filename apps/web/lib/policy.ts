// Client-side types + fetchers for the wind-policy comparison API.
// Mirrors apps/api/src/services/policy. No client-side diff math — the server
// computes `diff`; we render it.

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

export type ValueType = "numeric" | "boolean" | "enum" | "text";
export type Confidence = "verified" | "extracted" | "estimated";

export interface Diff {
  kind: "numeric" | "aligned" | "differs" | "state_silent" | "no_baseline" | "text";
  delta?: number | null;
  note?: string;
}

export interface Cell {
  value: number | boolean | string | null;
  display: string;
  raw: string | null;
  source: string | null;
  source_url: string | null;
  policy_year: number | null;
  confidence: Confidence | null;
  basis?: "rule";
  diff?: Diff;
}

export interface MetaJurisdiction {
  code: string;
  name: string;
  kind: "national" | "state";
}

export interface MetaDimension {
  key: string;
  label: string;
  category: string;
  value_type: ValueType;
  unit: string | null;
  description: string | null;
}

export interface Meta {
  jurisdictions: MetaJurisdiction[];
  dimensions: MetaDimension[];
}

export interface CompareResult {
  mode: "plain" | "diff";
  base?: string;
  year: number | null;
  jurisdictions: string[];
  dimensions: MetaDimension[];
  matrix: Record<string, Record<string, Cell>>;
}

export interface ChoroplethFC {
  type: "FeatureCollection";
  features: {
    type: "Feature";
    geometry: unknown;
    properties: { state_code: string; name: string; value: number; display: string };
  }[];
}

// Human labels for the category row-section headers (render order = spec §4).
export const CATEGORY_LABELS: Record<string, string> = {
  pricing: "Pricing",
  open_access: "Open Access",
  charges: "Charges",
  banking: "Banking",
  rpo: "RPO / RCO",
  dispatch: "Dispatch",
  repowering: "Repowering",
  land: "Land",
  incentives: "Incentives",
  clearances: "Clearances",
};

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, { credentials: "include" });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}) as { error?: string });
    throw new Error(body?.error || `${res.status} ${res.statusText}`);
  }
  return (await res.json()) as T;
}

export function fetchMeta(): Promise<Meta> {
  return getJson<Meta>("/api/policy/meta");
}

export function fetchCompare(
  codes: string[],
  year: number | null,
  base?: string,
): Promise<CompareResult> {
  const yq = year ? `&year=${year}` : "";
  if (base) {
    const targets = codes.filter((c) => c !== base);
    return getJson<CompareResult>(
      `/api/policy/compare?base=${encodeURIComponent(base)}&targets=${encodeURIComponent(targets.join(","))}${yq}`,
    );
  }
  return getJson<CompareResult>(
    `/api/policy/compare?jurisdictions=${encodeURIComponent(codes.join(","))}${yq}`,
  );
}

export function fetchChoropleth(dimension: string, year: number | null): Promise<ChoroplethFC> {
  const yq = year ? `&year=${year}` : "";
  return getJson<ChoroplethFC>(`/api/policy/choropleth?dimension=${encodeURIComponent(dimension)}${yq}`);
}
