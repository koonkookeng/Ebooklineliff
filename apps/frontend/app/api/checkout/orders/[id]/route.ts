// SSOT Phase 016 — Order detail proxy (Next.js → NestJS, auth passthrough)
import { NextResponse } from 'next/server';

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const backend = process.env.BACKEND_URL ?? 'http://localhost:4000';
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  const auth = req.headers.get('authorization');
  const cookie = req.headers.get('cookie');
  if (auth) h['authorization'] = auth;
  if (cookie) h['cookie'] = cookie;
  const { id } = await ctx.params;
  try {
    const res = await fetch(`${backend}/api/checkout/orders/${encodeURIComponent(id)}`, { headers: h });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ message: 'Checkout service unavailable' }, { status: 503 });
  }
}
