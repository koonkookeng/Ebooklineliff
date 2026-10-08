// SSOT Phase 075 §6 — Inventory stock proxy (tenant-isolated ledger)
// Canonical: apps/frontend/app/api/v1/inventory/stock/route.ts
import { NextResponse } from 'next/server';

export async function GET(req: Request) {
  const backend = process.env.BACKEND_URL ?? 'http://localhost:4000';
  const url = new URL(req.url);
  const tenant = url.searchParams.get('tenant') ?? 'default';
  const warehouseId = url.searchParams.get('warehouseId') ?? '';
  const q = url.searchParams.get('q') ?? '';
  const page = url.searchParams.get('page') ?? '1';
  const limit = url.searchParams.get('limit') ?? '20';

  const headers: Record<string, string> = { Accept: 'application/json', 'x-tenant-id': tenant };
  const auth = req.headers.get('authorization');
  const cookie = req.headers.get('cookie');
  if (auth) headers['authorization'] = auth;
  if (cookie) headers['cookie'] = cookie;

  try {
    const res = await fetch(
      `${backend}/api/v1/inventory/stock?warehouseId=${encodeURIComponent(warehouseId)}&q=${encodeURIComponent(q)}&page=${page}&limit=${limit}`,
      { headers },
    );
    return NextResponse.json(await res.json().catch(() => null), { status: res.status });
  } catch {
    return NextResponse.json({ message: 'Inventory service unavailable' }, { status: 503 });
  }
}