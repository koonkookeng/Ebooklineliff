// SSOT Phase 077 Task 7 — Shipment tracking proxy (LIFF view)
// Canonical: apps/frontend/app/api/v1/logistics/shipments/[orderId]/route.ts
import { NextResponse } from 'next/server';

export async function GET(req: Request, ctx: { params: { orderId: string } }) {
  const backend = process.env.BACKEND_URL ?? 'http://localhost:4000';
  const tenant = new URL(req.url).searchParams.get('tenant') ?? 'default';
  const headers: Record<string, string> = { Accept: 'application/json', 'x-tenant-id': tenant };
  const auth = req.headers.get('authorization');
  const cookie = req.headers.get('cookie');
  if (auth) headers['authorization'] = auth;
  if (cookie) headers['cookie'] = cookie;
  try {
    const res = await fetch(
      `${backend}/api/v1/logistics/shipments/${encodeURIComponent(ctx.params.orderId)}`,
      { headers },
    );
    return NextResponse.json(await res.json().catch(() => null), { status: res.status });
  } catch {
    return NextResponse.json({ message: 'Logistics service unavailable' }, { status: 503 });
  }
}
