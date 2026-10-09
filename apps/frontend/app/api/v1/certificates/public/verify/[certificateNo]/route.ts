// SSOT Phase 105 — Public verification proxy (NO auth forward — public page)
// Canonical: apps/frontend/app/api/v1/certificates/public/verify/[certificateNo]/route.ts
import { NextResponse } from 'next/server';

export async function GET(req: Request, { params }: { params: { certificateNo: string } }) {
  const backend = process.env.BACKEND_URL ?? 'http://localhost:4000';
  const hash = new URL(req.url).searchParams.get('hash');
  const q = hash ? `?hash=${encodeURIComponent(hash)}` : '';
  try {
    const res = await fetch(
      `${backend}/v1/public/certificates/verify/${encodeURIComponent(params.certificateNo)}${q}`,
      { headers: { Accept: 'application/json' } },
    );
    return NextResponse.json(await res.json().catch(() => null), { status: res.status });
  } catch {
    return NextResponse.json({ message: 'Verification service unavailable' }, { status: 503 });
  }
}
