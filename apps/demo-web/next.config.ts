import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  compiler: {
    removeConsole:
      process.env.NODE_ENV === 'production' ? { exclude: ['error'] } : false,
  },
  images: {
    remotePatterns: [
      {
        protocol: 'http',
        hostname: 'localhost',
      },
      {
        protocol: 'https',
        hostname: 'engine-demo.heripo.com',
      },
    ],
  },
  poweredByHeader: false,
  outputFileTracingExcludes: {
    '*': ['.venv/**'],
  },
};

export default nextConfig;
