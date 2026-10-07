/**
 * SSOT Phase 029 §6.1 — pointer only (no export on purpose).
 * Canonical Next config: apps/frontend/next.config.ts (splitChunks guard,
 * optimizePackageImports). This file MUST NOT export a config object —
 * Next.js loads a single config file and an export here could shadow the .ts.
 */
// intentionally export-less
