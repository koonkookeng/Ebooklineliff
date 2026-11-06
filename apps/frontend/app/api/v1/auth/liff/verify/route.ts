import { NextRequest, NextResponse } from 'next/server';
import { SESSION_COOKIE, backendBaseUrl } from '../../../../../../lib/auth-cookies';

const ACCESS_MAX_AGE_SEC = 15 * 60;

export async function POST(req: NextRequest): Promise<NextResponse> {
  const body = await req.text();
  try {
    const res = await fetch(`${backendBaseUrl()}/api/v1/auth/liff/verify`, {
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
    if (res.ok) {
      try {
        const parsed = JSON.parse(data) as { accessToken?: string; expiresIn?: number };
        if (typeof parsed.accessToken === 'string') {
          out.cookies.set(SESSION_COOKIE, parsed.accessToken, {
            httpOnly: true,
            secure: true,
            sameSite: 'strict',
            path: '/',
            maxAge: typeof parsed.expiresIn === 'number' ? parsed.expiresIn : ACCESS_MAX_AGE_SEC,
          });
        }
      } catch {
        // ignore parse errors; response already forwarded
      }
    }
    return out;
  } catch {
    return NextResponse.json({ error: 'backend_unavailable' }, { status: 502 });
  }
}