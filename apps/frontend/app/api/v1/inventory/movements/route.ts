// SSOT Phase 075 §6 — Inventory movements proxy (audit trail)
// Canonical: apps/frontend/app/api/v1/inventory/movements/route.ts
import { NextResponse } from 'next/server';

export async function GET(req: Request) {
  const backend = process.env.BACKEND_URL ?? 'http://localhost:4000';
  const url = new URL(req.url);
  const tenant = url.searchParams.get('tenant') ?? 'default';
  const sku = url.searchParams.get('sku') ?? '';
  const limit = url.searchParams.get('limit') ?? '20';

  const headers: Record<string, string> = { Accept: 'application/json', 'x-tenant-id': tenant };
  const auth = req.headers.get('authorization');
  const cookie = req.headers.get('cookie');
  if (auth) headers['authorization'] = auth;
  if (cookie) headers['cookie'] = cookie;

  try {
    const res = await fetch(
      `${backend}/api/v1/inventory/movements?sku=${encodeURIComponent(sku)}&limit=${limit}`,
      { headers },
    );
    return NextResponse.json(await res.json().catch(() => null), { status: res.status });
  } catch {
    return NextResponse.json({ message: 'Inventory service unavailable' }, { status: 503 });
  }
}