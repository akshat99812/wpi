/**
 * Wind-turbine manufacturing footprint — facility-level capacity by company,
 * state and component. Powers the "Manufacturing footprint" view in the
 * Technology tab.
 *
 * Sourced from MNRE ALMM / RLMM (Wind) manufacturer filings. Capacities are
 * stated in MW of annual manufacturing capacity per facility; `componentMfg`
 * lists which turbine components that facility produces (Blade / Hub / Tower).
 */

export interface MfgBranch {
  agencyName: string;
  companyType: string;
  companyTypeId: string;
  state: string;
  district: string;
  /** Annual manufacturing capacity for this facility, in MW. */
  mfgCapacity: number;
  branchAddress: string;
  /** Turbine components produced at this facility. */
  componentMfg: string[];
}

export interface MfgByCompanyType {
  companyTypeId: string;
  companyType: string;
  totalCapacityMW: number;
  branchCount: number;
}

export const MFG_BRANCHES: MfgBranch[] = [
  {
    agencyName: 'Suzlon Energy Limited',
    companyType: 'Turbine & Components Manufacturer',
    companyTypeId: '83a99c62-7622-4ff1-8c5d-3fc83659d00b',
    state: 'Madhya Pradesh',
    district: 'Dhar',
    mfgCapacity: 1.26,
    branchAddress:
      'SURVEY NO 289/2 290/1/2, 291, 296,297\r\nPATWARI HALKA NO. 25, BADNAWAR ROAD, VILLAGE BORALI,\r\nDHAR',
    componentMfg: ['Blade'],
  },
  {
    agencyName: 'Suzlon Energy Limited',
    companyType: 'Turbine & Components Manufacturer',
    companyTypeId: '83a99c62-7622-4ff1-8c5d-3fc83659d00b',
    state: 'Gujarat',
    district: 'Kachchh',
    mfgCapacity: 0.84,
    branchAddress:
      'SURVEY NO.588,BHUJ BHACHAU HIGHWAY, PADDHAR-VILLAGE, TAL.BHUJ,\r\nKUTCH',
    componentMfg: ['Blade'],
  },
  {
    agencyName: 'Suzlon Energy Limited',
    companyType: 'Turbine & Components Manufacturer',
    companyTypeId: '83a99c62-7622-4ff1-8c5d-3fc83659d00b',
    state: 'Rajasthan',
    district: 'Jaisalmer',
    mfgCapacity: 1.26,
    branchAddress: 'SURVEY NO.165/317/566, VILLAGE BHOO, PATWAR CIRCLE,\r\nJAISALMER',
    componentMfg: ['Blade'],
  },
  {
    agencyName: 'Suzlon Energy Limited',
    companyType: 'Turbine & Components Manufacturer',
    companyTypeId: '83a99c62-7622-4ff1-8c5d-3fc83659d00b',
    state: 'Andhra Pradesh',
    district: 'Ananthapuramu',
    mfgCapacity: 1.26,
    branchAddress: 'Sy No 153, 150, 152, 125, 154,Ipperu Village,Kuderu Mandal, Anantpur',
    componentMfg: ['Blade'],
  },
  {
    agencyName: 'Suzlon Energy Limited',
    companyType: 'Turbine & Components Manufacturer',
    companyTypeId: '83a99c62-7622-4ff1-8c5d-3fc83659d00b',
    state: 'Puducherry',
    district: 'Puducherry',
    mfgCapacity: 1.89,
    branchAddress: 'RS No 59, Village: THIRUVANDARKOIL, Dist: MANNNADIPET, Puducherry',
    componentMfg: ['Hub'],
  },
  {
    agencyName: 'Suzlon Energy Limited',
    companyType: 'Turbine & Components Manufacturer',
    companyTypeId: '83a99c62-7622-4ff1-8c5d-3fc83659d00b',
    state: 'Gujarat',
    district: 'Kachchh',
    mfgCapacity: 2.46,
    branchAddress: 'Plot No 365, Chopadva Village, Bhachau, Kutch, Gndhidham',
    componentMfg: ['Tower'],
  },
  {
    agencyName: 'Suzlon Energy Limited',
    companyType: 'Turbine & Components Manufacturer',
    companyTypeId: '83a99c62-7622-4ff1-8c5d-3fc83659d00b',
    state: 'Maharashtra',
    district: 'Dhule',
    mfgCapacity: 1.05,
    branchAddress: 'SURVEY NO.282, CHADVEL VILLAGE, TALUKA- SAKRI, DHULE',
    componentMfg: ['Blade'],
  },
  {
    agencyName: 'Suzlon Energy Limited',
    companyType: 'Turbine & Components Manufacturer',
    companyTypeId: '83a99c62-7622-4ff1-8c5d-3fc83659d00b',
    state: 'Dadra and Nagar Haveli and Daman and Diu',
    district: 'Daman',
    mfgCapacity: 2.52,
    branchAddress: 'Daman',
    componentMfg: ['Hub'],
  },
];

export const MFG_BY_COMPANY_TYPE: MfgByCompanyType[] = [
  {
    companyTypeId: '83a99c62-7622-4ff1-8c5d-3fc83659d00b',
    companyType: 'Turbine & Components Manufacturer',
    totalCapacityMW: 12.54,
    branchCount: 8,
  },
];

export const MFG_TOTAL_CAPACITY_MW = 12.54;
export const MFG_TOTAL_BRANCHES = 8;

/** Per-component colour (one source of truth for chips + legend). */
export const COMPONENT_META: Record<string, { color: string; label: string }> = {
  Blade: { color: '#5ec26a', label: 'Blade' },
  Hub: { color: '#7bc4e2', label: 'Hub' },
  Tower: { color: '#ff8a1f', label: 'Tower' },
  Nacelle: { color: '#b06be0', label: 'Nacelle' },
};

export const MFG_CAPACITY_AS_OF = 'June 2026';
