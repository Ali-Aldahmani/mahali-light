import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const expressBase = (process.env.EXPRESS_INTERNAL_URL || 'http://127.0.0.1:3000').replace(
  /\/$/,
  '',
);

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  reactStrictMode: true,
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: false },
  outputFileTracingRoot: path.join(__dirname, '..'),
  async rewrites() {
    return [
      { source: '/api/:path*', destination: `${expressBase}/api/:path*` },
      { source: '/files/:path*', destination: `${expressBase}/files/:path*` },
    ];
  },
};

export default nextConfig;
