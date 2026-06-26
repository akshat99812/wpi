/** @type {import('next').NextConfig} */
//
// `basePath` is read from NEXT_PUBLIC_BASE_PATH so dev stays at `/` and
// production (okagarenewables.com/terminal) stays at `/terminal`. Setting
// `assetPrefix` to the same value keeps _next/static URLs aligned.
const basePath = process.env.NEXT_PUBLIC_BASE_PATH || '';

const nextConfig = {
  basePath,
  assetPrefix: basePath || undefined,
  // The Chatbot and Policy Comparison tools moved under the Research section's
  // sidebar. Keep their old standalone URLs working (query strings are
  // forwarded automatically). basePath is applied to these redirects too.
  async redirects() {
    return [
      { source: '/chat', destination: '/research/chatbot', permanent: true },
      { source: '/policy', destination: '/research/policy', permanent: true },
    ];
  },
};

export default nextConfig;
