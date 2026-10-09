// SSOT Phase 103 Task 5 — Ticket attachment presigned-upload proxy (member JWT → R2 zero-egress)
// Canonical: apps/frontend/app/api/v1/support/tickets/[id]/messages/[messageId]/attachments/route.ts
import { NextResponse } from 'next/server';

export async function POST(
  req: Request,
  { params }: { params: { id: string; messageId: string } },
) {
  const backend = process.env.BACKEND_URL ?? 'http://localhost:4000';
  const tenant = new URL(req.url).searchParams.get('tenant') ?? 'default';
  const body = await req.json().catch(() => null);
  const h: Record<string, string> = { 'Content-Type': 'application/json', 'x-tenant-id': tenant };
  const auth = req.headers.get('authorization');
  const cookie = req.headers.get('cookie');
  if (auth) h['authorization'] = auth;
  if (cookie) h['cookie'] = cookie;
  try {
    const res = await fetch(
      `${backend}/api/v1/support/tickets/${encodeURIComponent(params.id)}/messages/${encodeURIComponent(params.messageId)}/attachments`,
      { method: 'POST', headers: h, body: JSON.stringify(body) },
    );
    return NextResponse.json(await res.json().catch(() => null), { status: res.status });
  } catch {
    return NextResponse.json({ message: 'Support service unavailable' }, { status: 503 });
  }
}
