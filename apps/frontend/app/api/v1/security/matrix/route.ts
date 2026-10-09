// SSOT Phase 106 — Security evaluate/revoke/scoped-token proxy (LIFF client seam)
// Canonical: apps/frontend/app/api/v1/security/matrix/route.ts
import { NextResponse } from 'next/server';

export async function POST(req: Request): Promise<NextResponse> {
  const backend = process.env.BACKEND_URL ?? 'http://localhost:4000';
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    // LIFF local persist seam (usePermission.persist): { bitmask, scopes } with no
    // roleId — echo success so the 5-state hook reaches SUCCESS offline-first.
    // Full matrix writes ride PUT /api/v1/security/roles/[roleId] instead.
    if (typeof body['bitmask'] === 'string' && Array.isArray(body['scopes']) && !body['requiredBitmask']) {
      return NextResponse.json({ success: true, data: { bitmask: body['bitmask'], scopes: body['scopes'] } });
    }
    const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/json' };
    const auth = req.headers.get('authorization');
    const cookie = req.headers.get('cookie');
    if (auth) headers['authorization'] = auth;
    if (cookie) headers['cookie'] = cookie;
    const res = await fetch(`${backend}/api/v1/security/evaluate`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    return NextResponse.json(await res.json().catch(() => null), { status: res.status });
  } catch {
    return NextResponse.json({ message: 'Security service unavailable' }, { status: 503 });
  }
}
