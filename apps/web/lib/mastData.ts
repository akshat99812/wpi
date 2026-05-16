// Wind monitoring masts (all-India sample).
// Source: apps/api/data/mastDataSample.kmz — extracted from CECL's
// "All India WM List May 2026" KMZ. Each placemark's <Point><coordinates>
// gives the actual mast location (the <LookAt> camera position is ignored).
// Hub height is parsed from the placemark name where present.

export interface MastPoint {
  /** Verbatim placemark name from the KMZ. */
  name: string;
  /** Longitude (decimal degrees). */
  lon: number;
  /** Latitude (decimal degrees). */
  lat: number;
  /** Hub height parsed from the name (e.g. "120 m", "150 m"). */
  hubHeight?: string;
}

export const MAST_POINTS: MastPoint[] = [
  { name: 'Gagodhar-2 Pvt. WM 120 m (Dec 2013 – Jan 2015)',                  lon: 70.78985490318824, lat: 23.38153727379815, hubHeight: '120 m' },
  { name: 'Paragpar Pvt. WM 150 m (Nov 2020 – Nov 2021)',                    lon: 70.73072981023188, lat: 23.54214375511441, hubHeight: '150 m' },
  { name: 'Kottur Pvt. WM 125 m (Dec 2013 – Feb 2016)',                      lon: 76.25431125340320, lat: 14.79480441836481, hubHeight: '125 m' },
  { name: 'Jogihalli-3 Pvt. WM 125 m (Sep 2011 – Feb 2016)',                 lon: 76.32640872824938, lat: 14.58556492243431, hubHeight: '125 m' },
  { name: 'Konapuram Pvt. WM 120 m',                                          lon: 77.55422050905240, lat: 14.41869480153420, hubHeight: '120 m' },
  { name: 'Basavanakote Pvt. WM 125 m',                                       lon: 76.09629698435772, lat: 14.72073179268574, hubHeight: '125 m' },
  { name: 'Itagi Pvt. WM 125 m',                                              lon: 76.11010489813899, lat: 14.93873501451141, hubHeight: '125 m' },
  { name: 'Devereddypalli Pvt. WM 100 m',                                     lon: 77.56000226537196, lat: 14.46064792554853, hubHeight: '100 m' },
  { name: 'Madapuram Pvt. WM 120 m',                                          lon: 77.44999793444362, lat: 14.39250719961304, hubHeight: '120 m' },
  { name: 'Konchapatti Mast-2 Pvt. WM 100 m',                                 lon: 78.28674422818169, lat: 10.79320924754929, hubHeight: '100 m' },
  { name: 'Topudurt Pvt. WM 120 m',                                           lon: 77.50126075382933, lat: 14.56862196161182, hubHeight: '120 m' },
  { name: 'Konchapatti Mast-1 Pvt. WM 130 m',                                 lon: 78.26052717665512, lat: 10.83955968157014, hubHeight: '130 m' },
  { name: 'Kuslamb Pvt. WM 140 m',                                            lon: 75.38666593385804, lat: 18.85464694181814, hubHeight: '140 m' },
  { name: 'Aladar Pvt. WM 150 m (Jul 2024 – Jun 2025)',                       lon: 72.65653072927776, lat: 21.83078258627040, hubHeight: '150 m' },
  { name: 'Pir Lashshasar Pvt. WM 130 m (Jul 2007 – May 2010)',               lon: 69.80771276892273, lat: 22.13779216529648, hubHeight: '130 m' },
  { name: 'Khijadad HT Pvt. WM 120 m',                                        lon: 69.42846228280119, lat: 22.03717726674381, hubHeight: '120 m' },
  { name: 'Golangri Pvt. WM 140 m (Jun 2023 – Mar 2025)',                     lon: 75.63915408867636, lat: 18.70670433026135, hubHeight: '140 m' },
  { name: 'Daskhed Pvt. WM (Jan 2014 – Aug 2015)',                            lon: 75.56320175556284, lat: 18.74899985355633 },
  { name: 'Patoda Pvt. WM 140 m (Jul 2023 – Mar 2025)',                       lon: 75.49832678136650, lat: 18.82162945572907, hubHeight: '140 m' },
  { name: 'Kharda Sakat Pvt. WM (Nov 2014 – Jun 2016)',                       lon: 75.44404879289004, lat: 18.76745923909751 },
  { name: 'Raymog Pvt. WM 100 m (Sep 2013 – Aug 2014)',                       lon: 75.47974526972071, lat: 18.88231128803821, hubHeight: '100 m' },
];
