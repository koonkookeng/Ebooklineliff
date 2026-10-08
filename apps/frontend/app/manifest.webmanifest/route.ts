// SSOT Phase 062 Task 5 — Multi-tenant Web App Manifest (?tenant=)
// Canonical: apps/frontend/app/manifest.webmanifest/route.ts
// - Dynamic manifest: name/theme/accent per tenant (LIFF query precedent);
//   icons+start_url stable so installability holds per tenant.
// - Zero new deps.
import { NextResponse } from 'next/server';

const TENANTS: Record<string, { name: string; short: string; theme: string }> = {
  default: { name: 'Ebook LINE LIFF', short: 'EbookLIFF', theme: '#059669' },
};

export async function GET(req: Request) {
  const tenant = new URL(req.url).searchParams.get('tenant') ?? 'default';
  const t = TENANTS[tenant] ?? TENANTS.default;
  return NextResponse.json(
    {
      name: t.name,
      short_name: t.short,
      start_url: `/?tenant=${encodeURIComponent(tenant)}`,
      scope: '/',
      display: 'standalone',
      background_color: '#ffffff',
      theme_color: t.theme,
      icons: [
        { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
        { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
      ],
    },
    { headers: { 'content-type': 'application/manifest+json', 'cache-control': 'public, max-age=3600' } },
  );
}
