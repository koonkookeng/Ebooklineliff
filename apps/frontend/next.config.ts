// SSOT Phase 001 §6 — Next.js 15 App Router config
// Phase 029 §6.1 — split-chunks guard (initial bundle < 2MB, heavy engines async).
// NOTE: no @next/bundle-analyzer dep (zero-new-deps policy); CI enforces the
// 2MB ceiling via scripts/check-bundle-size.ts against the same BUNDLE_MAX_BYTES.
import path from 'node:path';
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Container/runtime artifact: .next/standalone + .next/static + public
  // (see apps/frontend/Dockerfile). Keeps the production image small.
  output: 'standalone',
  // Trace from the monorepo root so workspace packages (e.g. @repo/shared)
  // are copied into .next/standalone. The standalone tree then mirrors the
  // repo layout and server.js lives at standalone/apps/frontend/server.js.
  outputFileTracingRoot: path.join(process.cwd(), '../../'),
  // The repo-level .eslintrc.js targets Node sources and lacks the Next/browser
  // plugins, so running ESLint inside `next build` fails on browser globals.
  // Linting remains available via `pnpm lint` / `pnpm --filter ... typecheck`.
  eslint: { ignoreDuringBuilds: true },
  experimental: {
    optimizePackageImports: ['lucide-react', 'recharts', 'react-hook-form'],
  },
  webpack: (config, { isServer, webpack }) => {
    if (!isServer) {
      // @repo/shared is a single CJS barrel; browser bundles only need its
      // Zod contracts. Node-only hashing helpers must not pull node:crypto
      // into the client graph (they are never invoked client-side).
      // `resolve.alias` alone does not intercept the `node:` scheme, so use
      // IgnorePlugin, which runs before module resolution.
      config.resolve = config.resolve ?? {};
      config.resolve.alias = { ...(config.resolve.alias ?? {}), 'node:crypto': false };
      config.plugins.push(new webpack.IgnorePlugin({ resourceRegExp: /^node:crypto$/ }));
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
