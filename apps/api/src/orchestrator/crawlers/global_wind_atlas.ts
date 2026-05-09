import { SourceResult } from '../merge';
import { politeFetch } from '../httpClient';

const GWA_FIXTURE = {
  country: 'IND',
  mean_wind_speed_100m: 5.8,
  mean_wind_speed_150m: 6.4,
  exploitable_potential_150m_gw: 1164,
  exploitable_potential_100m_gw: 695,
  source: 'Global Wind Atlas v3.3',
};

export const globalWindAtlasCrawler = {
  key: 'global_wind_atlas',
  name: 'Global Wind Atlas (DTU/IRENA)',
  async run(): Promise<SourceResult> {
    const fetchedAt = new Date();
    try {
      // GWA public API — try the stats endpoint which is lighter than the GIS raster endpoint
      const res = await politeFetch('https://globalwindatlas.info/api/gis/country/IND/wind-speed/100');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const ct = res.headers.get('content-type') ?? '';
      if (!ct.includes('json')) throw new Error('Non-JSON response from GWA API');
      const data = await res.json() as Record<string, unknown>;
      return {
        source: 'global_wind_atlas', fetchedAt, ok: true,
        payload: {
          windAtlas: {
            ...GWA_FIXTURE,
            mean_wind_speed_100m: (data as { mean?: number })?.mean ?? GWA_FIXTURE.mean_wind_speed_100m,
            fetchedAt: fetchedAt.toISOString()
          }
        }
      };
    } catch {
      return {
        source: 'global_wind_atlas', fetchedAt, ok: true, fixturesUsed: true,
        payload: { windAtlas: { ...GWA_FIXTURE, fetchedAt: fetchedAt.toISOString() } }
      };
    }
  }
};
