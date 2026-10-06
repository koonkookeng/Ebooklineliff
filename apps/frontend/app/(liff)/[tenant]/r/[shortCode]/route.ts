// SSOT Phase 025 §6.1/Task 4 — Tenant short-link server route (redirect dispatch)
// Canonical: apps/frontend/app/(liff)/[tenant]/r/[shortCode]/route.ts
// (legacy src/frontend/app/(liff)/[tenant]/r/[shortCode]/route.ts)
// - Server-side resolve → 307 to targetUrl (preserves affiliate query already
//   embedded in customPath). Unknown/expired → /store (never a 500, Gate 9).
// - Passes UA + referer + IP so the backend classifier/rate-limiter see the
//   real caller; click logging + Redis stream attribution happen backend-side.
import { NextResponse } from 'next/server';
import { ShortCodeParamSchema } from '@repo/shared';

interface RouteParams {
  params: Promise<{ tenant: string; shortCode: string }>;
}

function storeUrl(req: Request): string {
  return new URL('/store', req.url).toString();
}

export async function GET(req: Request, { params }: RouteParams): Promise<NextResponse> {
  const { shortCode } = await params;
  // SSOT boundary: same ShortCode rule as backend (fail-closed → /store).
  if (!ShortCodeParamSchema.safeParse({ shortCode }).success) {
    return NextResponse.redirect(storeUrl(req), { headers: { 'Cache-Control': 'no-store' } });
  }
  const backend = process.env.BACKEND_URL ?? 'http://localhost:4000';
  const h: Record<string, string> = {};
  const ua = req.headers.get('user-agent');
  const ref = req.headers.get('referer');
  const fwd = req.headers.get('x-forwarded-for');
  if (ua) h['user-agent'] = ua;
  if (ref) h['referer'] = ref;
  if (fwd) h['x-forwarded-for'] = fwd;
  try {
    const res = await fetch(
      `${backend}/api/v1/resolver/resolve?code=${encodeURIComponent(shortCode)}`,
      { method: 'GET', headers: h },
    );
    if (!res.ok) return NextResponse.redirect(storeUrl(req), { headers: { 'Cache-Control': 'no-store' } });
    const data = (await res.json()) as { targetUrl?: string; customPath?: string };
    const target = data.customPath || data.targetUrl || '/store';
    const dest = target.startsWith('/') ? new URL(target, req.url).toString() : storeUrl(req);
    return NextResponse.redirect(dest, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.redirect(storeUrl(req), { headers: { 'Cache-Control': 'no-store' } });
  }
}
