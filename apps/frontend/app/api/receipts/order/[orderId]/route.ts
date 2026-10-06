// SSOT Phase 019 §6 — Receipt detail proxy (auth passthrough)
import { NextResponse } from 'next/server';

export async function GET(req: Request, ctx: { params: Promise<{ orderId: string }> }) {
  const backend = process.env.BACKEND_URL ?? 'http://localhost:4000';
  try {
    const { orderId } = await ctx.params;
    const h: Record<string, string> = { 'Content-Type': 'application/json' };
    const auth = req.headers.get('authorization');
    const cookie = req.headers.get('cookie');
    if (auth) h['authorization'] = auth;
    if (cookie) h['cookie'] = cookie;
    const res = await fetch(`${backend}/api/receipts/order/${encodeURIComponent(orderId)}`, { headers: h });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ message: 'Receipt service unavailable' }, { status: 503 });
  }
}
