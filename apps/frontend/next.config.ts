// SSOT Phase 001 §6 — Next.js 15 App Router config
// Phase 029 §6.1 — split-chunks guard (initial bundle < 2MB, heavy engines async).
// NOTE: no @next/bundle-analyzer dep (zero-new-deps policy); CI enforces the
// 2MB ceiling via scripts/check-bundle-size.ts against the same BUNDLE_MAX_BYTES.
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  experimental: {
    optimizePackageImports: ['lucide-react', 'recharts', 'react-hook-form'],
  },
  webpack: (config, { isServer }) => {
    if (!isServer) {
      config.optimization.splitChunks = {
        chunks: 'all',
        maxInitialRequests: 25,
        minSize: 20000,
        maxSize: 500000,
        cacheGroups: {
          default: false,
          vendors: false,
          framework: {
            name: 'framework',
            test: /[/\\]node_modules[/\\](react|react-dom|next)[/\\]/,
            priority: 40,
            chunks: 'all',
          },
          readerCanvas: {
            name: 'reader-canvas',
            test: /[/\\]components[/\\]reader[/\\]/,
            priority: 30,
            chunks: 'async',
          },
          hlsPlayer: {
            name: 'hls-player',
            test: /[/\\]node_modules[/\\](hls\.js|video\.js)[/\\]/,
            priority: 30,
            chunks: 'async',
          },
          commons: {
            name: 'commons',
            minChunks: 2,
            priority: 20,
          },
        },
      };
    }
    return config;
  },
};

export default nextConfig;
