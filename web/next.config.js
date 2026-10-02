/** @type {import('next').NextConfig} */
const nextConfig = {
  // CORS lives in lib/cors.ts (middleware + route responses). It is not
  // repeated here, so the three copies cannot drift.
  eslint: {
    ignoreDuringBuilds: true,
  },
};

module.exports = nextConfig;
