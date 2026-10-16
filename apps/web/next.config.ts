import type { NextConfig } from 'next';
import path from 'node:path';
import fs from 'node:fs';

// read API_URL from the monorepo .env when not provided by the environment
function rootEnv(key: string): string | undefined {
  try {
    const file = fs.readFileSync(path.resolve(__dirname, '../../.env'), 'utf8');
    const line = file.split(/\r?\n/).find(l => l.startsWith(`${key}=`));
    return line?.slice(key.length + 1).trim();
  } catch { return undefined; }
}
const API_URL = process.env.API_URL ?? rootEnv('API_URL') ?? 'http://localhost:4000';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${API_URL}/api/:path*` }];
  },
  async headers() {
    return [{
      source: '/:path*',
      headers: [
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        { key: 'X-Frame-Options', value: 'DENY' },
      ],
    }];
  },
};
export default nextConfig;
