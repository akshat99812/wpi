import { test, expect } from 'bun:test';
import { displayNameFromLabel } from './privateMastName';

// Every case is a real label from privateMasts.csv.
const CASES: Array<[raw: string, clean: string]> = [
  ['Aladar150m Jul24-Jun25_Pvt. Mast', 'Aladar'],
  ['Ratkuriya-V_Pvt. WM_65m', 'Ratkuriya-V'],
  ['Masbinal_Pvt. WM-93m', 'Masbinal'],
  ['Kudre Konda_Pvt. WM_56m', 'Kudre Konda'],
  ['Suro Ki Dhani - West_Pvt. WM_80m', 'Suro Ki Dhani - West'],
  ['Suriyakheda 100m _Pvt. WM', 'Suriyakheda'],
  ['Bhudhni_MPWL_65m_WM_Feb2009-May2011', 'Bhudhni'],
  ['Kotraq buzurg MPWL WM', 'Kotraq buzurg'],
  ['Mokal_Suzlon_80m', 'Mokal'],
  ['Jura CECL_65m_WM_June2010-May2013', 'Jura'],
  ['Nipaniya_MEIL_65m_WM_Apr2009-Feb2012', 'Nipaniya'],
  ['Kottur 125m_Pvt._WM_Dec2013_ Feb 2016', 'Kottur'],
  ['Aland 100m_Pvt. Mast', 'Aland'],
  ['Rajgarh_Pvt. WM_79.5m', 'Rajgarh'],
  ['Banswara-4_Pvt. WM_76m', 'Banswara-4'],
  ['Igatpuri - II_Pvt. WM_58m', 'Igatpuri - II'],
  ['Pulakurthi_Pvt.WM_80m', 'Pulakurthi'],
  ['Sanjivarayani kota _Pvt. WM- Jan07-dec07', 'Sanjivarayani kota'],
  ['Molakalmur _Pvt. WM-125m_May2013_Apr 2016', 'Molakalmur'],
  ['Yermala _Pvt. WM-100m_Nov. 2010- July 2015', 'Yermala'],
  ['Twargera_Dec2010_Mar2014_Pvt. Mast', 'Twargera'],
  ['Pethshivapur-1_50m Ht._April 2008 to March 2009', 'Pethshivapur-1'],
  [
    'Rangayanadurga_Hanumanahalli_100m_wm_Jan 2011-Oct 2015_Pvt. Mast',
    'Rangayanadurga Hanumanahalli',
  ],
  ['Dungarsi House (Bebar) CECL_65m_Mar2012-May2013', 'Dungarsi House (Bebar)'],
  ['Varar Hii_2may 2010', 'Varar Hii'],
  ['Eguvapalli_Guttaseema Wind_80m', 'Eguvapalli Guttaseema Wind'],
  ['Santhalpur _Pvt. WM', 'Santhalpur'],
  // Marker sits at position 0 — the name follows the suffix instead.
  ['_Pvt. WM-Humbarne', 'Humbarne'],
  // CSV-quoted label with embedded quotes.
  ['Sandhikheda "Trade wind" 65m_WM_Jun2014-Aug2015', 'Sandhikheda'],
  ['Shamgarh" Panama" 100m WM_Jun2014-', 'Shamgarh'],
  // A multiline CSV-quoted label with an embedded comma.
  ['Kalmangi,_Pvt. WM_56m', 'Kalmangi'],
  // The mast really is named "Mast-1" — a marker word opens the label.
  ['Mast-1_80m_Apr11_Mar2012_Pvt. Mast', 'Mast-1'],
  ['Mast-1 Konchapatti 130m_Pvt. Mast', 'Mast-1 Konchapatti'],
  ['Mast-2 Konchapatti 100m_Pvt. Wind', 'Mast-2 Konchapatti'],
  // Name trails the markers, with stray metadata after it too.
  ['_Pvt. WM- Sailana WM 65 M', 'Sailana'],
  // A space-separated trailing digit is a name suffix, not a date prefix.
  ['Sri Palvan-1 Dec09-Nov2010 _Pvt. WM', 'Sri Palvan-1'],
  // Markers arriving glued to the name.
  ['PeddakodipallePvt.WM_80m', 'Peddakodipalle'],
  ['Chadmal_Ht100m', 'Chadmal'],
  ['GAJPUR Ghata_CECLWM_65m_July2009-Dec2011', 'GAJPUR Ghata'],
  // Footnote stars, OEM codes, quoted operators, period notes.
  ['Madugupalli**_Pvt.WM_80m', 'Madugupalli'],
  ['Marpanahalli - 1_Vestas_72m', 'Marpanahalli - 1'],
  ["Annoppura 'Paribaha' 65m_WM_Jun 2012-June2017", 'Annoppura'],
  ['Bhoom -Malewadi- 1 Year data Pvt. Mast', 'Bhoom -Malewadi'],
  // Unnamed degenerate rows: the tidied label beats a bare digit.
  ['Pvt. WM-2', 'Pvt. WM-2'],
  ['_Pvt. WM', 'Pvt. WM'],
];

for (const [raw, clean] of CASES) {
  test(`cleans "${raw}" → "${clean}"`, () => {
    expect(displayNameFromLabel(raw)).toBe(clean);
  });
}

test('keeps a multiline quoted label to its first line', () => {
  expect(displayNameFromLabel('Kalmangi\n65m_WM')).toBe('Kalmangi');
});

test('never returns an empty string for a non-empty label', () => {
  expect(displayNameFromLabel('Met Mast').length).toBeGreaterThan(0);
});

test('place names starting with a month prefix are not clipped', () => {
  // "May…" as a word only counts as a date when digits follow.
  expect(displayNameFromLabel('Mayurbhanj_Pvt. WM_80m')).toBe('Mayurbhanj');
});
