// Illustrative Indian wind-project sites for the destination picker
// (LOGISTICS_TOOL_PLAN.md §7). Users can also enter a manual lat/lon.
export interface PresetSite {
  name: string;
  state: string;
  lat: number;
  lon: number;
}

export const PRESET_SITES: PresetSite[] = [
  { name: "Khavda RE Park (Kutch)", state: "Gujarat", lat: 23.86, lon: 69.86 },
  { name: "Jaisalmer", state: "Rajasthan", lat: 26.91, lon: 70.92 },
  { name: "Gadag", state: "Karnataka", lat: 15.42, lon: 75.63 },
  { name: "Anantapur", state: "Andhra Pradesh", lat: 14.68, lon: 77.6 },
  { name: "Aralvaimozhi (Tirunelveli)", state: "Tamil Nadu", lat: 8.3, lon: 77.5 },
  { name: "Dharashiv (Osmanabad)", state: "Maharashtra", lat: 18.18, lon: 76.04 },
  { name: "Bhavnagar", state: "Gujarat", lat: 21.76, lon: 72.15 },
];
