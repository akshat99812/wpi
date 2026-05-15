/** @type {import('next').NextConfig} */
//
// `basePath` is read from NEXT_PUBLIC_BASE_PATH so dev stays at `/` and
// production (okagarenewables.com/terminal) stays at `/terminal`. Setting
// `assetPrefix` to the same value keeps _next/static URLs aligned.
const basePath = process.env.NEXT_PUBLIC_BASE_PATH || '';

const nextConfig = {
  basePath,
  assetPrefix: basePath || undefined,
};

export default nextConfig;
