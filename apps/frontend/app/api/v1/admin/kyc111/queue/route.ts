// SSOT Phase 111 §3.2 — admin KYC queue proxy (masked + 300s doc URLs)
// Canonical: apps/frontend/app/api/v1/admin/kyc111/queue/route.ts
import { NextResponse } from 'next/server';

function passthrough(req: Request, tenant: string): Record<string, string> {
  const h: Record<string, string> = { Accept: 'application/json', 'x-tenant-id': tenant };
  const auth = req.headers.get('authorization');
  const cookie = req.headers.get('cookie');
  if (auth) h['authorization'] = auth;
  if (cookie) h['cookie'] = cookie;
  return h;
}

export async function GET(req: Request) {
  const backend = process.env.BACKEND_URL ?? 'http://localhost:4000';
  const url = new URL(req.url);
  const tenant = url.searchParams.get('tenant') ?? 'default';
  const forward = new URLSearchParams();
  for (const k of ['status', 'riskLevel', 'page', 'limit']) {
    const v = url.searchParams.get(k);
    if (v) forward.set(k, v);
  }
  try {
    const res = await fetch(`${backend}/api/v1/admin/kyc111/queue?${forward.toString()}`, {
      headers: passthrough(req, tenant),
    });
    return NextResponse.json(await res.json().catch(() => null), { status: res.status });
  } catch {
    return NextResponse.json({ message: 'KYC queue unavailable' }, { status: 503 });
  }
}
