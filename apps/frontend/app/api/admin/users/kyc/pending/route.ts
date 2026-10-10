// SSOT Phase 109 §6 — KYC pending list proxy
import { NextResponse } from 'next/server';

export async function GET(req: Request) {
  const backend = process.env.BACKEND_URL ?? 'http://localhost:4000';
  try {
    const url = new URL(req.url);
    const headers: Record<string, string> = {};
    const auth = req.headers.get('authorization');
    const cookie = req.headers.get('cookie');
    if (auth) headers['authorization'] = auth;
    if (cookie) headers['cookie'] = cookie;
    const res = await fetch(`${backend}/api/v1/admin/users/kyc/pending${url.search}`, { headers });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ message: 'Admin user service unavailable' }, { status: 503 });
  }
}
