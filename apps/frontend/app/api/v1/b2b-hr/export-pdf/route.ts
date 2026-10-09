// SSOT Phase 098 Task 6 — HR PDF export proxy (binary passthrough + seal)
// Canonical: apps/frontend/app/api/v1/b2b-hr/export-pdf/route.ts
import { NextResponse } from 'next/server';

export async function GET(req: Request) {
  const backend = process.env.BACKEND_URL ?? 'http://localhost:4000';
  const url = new URL(req.url);
  const orgId = url.searchParams.get('orgId') ?? '';
  const tenant = url.searchParams.get('tenant') ?? 'default';
  const h: Record<string, string> = { 'x-tenant-id': tenant };
  const auth = req.headers.get('authorization');
  const cookie = req.headers.get('cookie');
  if (auth) h['authorization'] = auth;
  if (cookie) h['cookie'] = cookie;
  try {
    const res = await fetch(`${backend}/api/v1/b2b-hr/export-pdf?orgId=${encodeURIComponent(orgId)}`, { headers: h });
    const buf = Buffer.from(await res.arrayBuffer());
    return new NextResponse(buf, {
      status: res.status,
      headers: {
        'Content-Type': 'application/pdf',
        'X-Report-Seal': res.headers.get('x-report-seal') ?? '',
        'Content-Disposition': `attachment; filename="hr-report-${orgId}.pdf"`,
      },
    });
  } catch {
    return NextResponse.json({ message: 'HR service unavailable' }, { status: 503 });
  }
}
