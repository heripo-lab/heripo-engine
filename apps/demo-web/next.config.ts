import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  compiler: {
    removeConsole: {
      exclude: ['error'],
    },
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
