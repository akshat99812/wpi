// Display formatters for Pro-map mast attributes. Extracted from the page so
// the sidebar tool and any future consumers share one implementation.

const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

/** Format a source date (DD/MM/YYYY or DD-MM-YYYY) as "3 Jun 2021". */
export function fmtDate(d: string | null): string | null {
  if (!d) return null;
  // Source dates are DD/MM/YYYY (or DD-MM-YYYY); JS Date can't parse those reliably.
  const dmy = d.trim().match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (dmy) {
    const day = Number(dmy[1]);
    const month = Number(dmy[2]);
    const year = dmy[3];
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return `${day} ${MONTHS[month - 1]} ${year}`;
    }
  }
  // Fallback: ISO or other Date-parseable strings.
  const parsed = new Date(d);
  if (Number.isNaN(parsed.getTime())) return d;
  return `${parsed.getDate()} ${MONTHS[parsed.getMonth()]} ${parsed.getFullYear()}`;
}

/** Format a lat/lon pair as "22.5937° N, 78.9629° E". */
export function fmtCoords(lat: number, lon: number): string {
  const ns = lat >= 0 ? 'N' : 'S';
  const ew = lon >= 0 ? 'E' : 'W';
  return `${Math.abs(lat).toFixed(4)}° ${ns}, ${Math.abs(lon).toFixed(4)}° ${ew}`;
}

/** Group a number with Indian locale separators (e.g. 4701.406 → "4,701.4",
 *  2104 → "2,104"), keeping up to `digits` decimals. Accepts the
 *  `number | string | null` pg returns for NUMERIC columns; null when non-finite. */
export function fmtGrouped(
  n: number | string | null,
  digits = 0,
): string | null {
  if (n == null || n === '') return null;
  const v = typeof n === 'number' ? n : Number(n);
  if (!Number.isFinite(v)) return null;
  return v.toLocaleString('en-IN', { maximumFractionDigits: digits });
}

/** Format a numeric attribute with a unit, trimming trailing zeros. Accepts the
 *  `number | string | null` the API returns for proprietary fields. */
export function fmtNum(
  n: number | string | null,
  unit: string,
  digits = 2,
): string | null {
  if (n == null || n === '') return null;
  const v = typeof n === 'number' ? n : Number(n);
  if (!Number.isFinite(v)) return null;
  return `${v.toFixed(digits).replace(/\.?0+$/, '')} ${unit}`;
}
