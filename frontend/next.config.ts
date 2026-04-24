import type { NextConfig } from "next";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:9000';

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `${API_BASE}/api/:path*`,
      },
      {
        source: '/health',
        destination: `${API_BASE}/health`,
      },
    ];
  },
};

export default nextConfig;
