/**
 * Same-origin static assets (everything under public/) are served from the
 * app's basePath. In dev that's `/` (NEXT_PUBLIC_BASE_PATH empty); in
 * production the whole Next app is mounted under `/terminal`
 * (okagarenewables.com/terminal), so a file like public/wind-atlas/foo.png is
 * served at `/terminal/wind-atlas/foo.png` — NOT at the host root.
 *
 * next.config.mjs reads the prefix from NEXT_PUBLIC_BASE_PATH; that variable is
 * a NEXT_PUBLIC_* var, so it's inlined into the client bundle and readable here
 * in the browser. Next.js prefixes basePath onto its own <Link>/router and
 * _next/static URLs automatically, but NOT onto URLs you build by hand for
 * fetch()/XHR or MapLibre tile templates — those must be prefixed explicitly,
 * or they 404 in production (this is exactly why the wind-atlas raster tiles
 * failed to load on the deployed Pro map).
 */
export const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH || '';

/**
 * Prefix a root-relative public-asset path with the app's basePath.
 * `path` must start with '/'. In dev (empty basePath) it's returned unchanged.
 */
export function assetPath(path: string): string {
  return `${BASE_PATH}${path}`;
}
