import { NextRequest, NextResponse } from 'next/server';
import { applySessionCookies, backendBaseUrl } from '../../../../../lib/auth-cookies';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: NextRequest, context: { params: Promise<{ token: string }> }): Promise<NextResponse> {
  const { token } = await context.params;
  if (!UUID_RE.test(token)) return NextResponse.json({ error: 'invalid_token' }, { status: 400 });
  const body = await req.text();
  try {
    const res = await fetch(`${backendBaseUrl()}/api/v1/auth/qr/${token}/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      cache: 'no-store',
    });
    const data = await res.text();
    const out = new NextResponse(data, {
      status: res.status,
      headers: { 'Content-Type': res.headers.get('content-type') ?? 'application/json' },
    });
    // Forward the __Host- cookies the backend sets on completion.
    const setCookie = res.headers.getSetCookie?.() ?? [];
    for (const cookie of setCookie) out.headers.append('set-cookie', cookie);
    if (setCookie.length === 0) {
      const single = res.headers.get('set-cookie');
      if (single) out.headers.append('set-cookie', single);
    }
    return out;
  } catch {
    return NextResponse.json({ error: 'backend_unavailable' }, { status: 502 });
  }
}