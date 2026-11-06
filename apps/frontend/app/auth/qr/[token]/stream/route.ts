// SSOT Phase 131 §6.11 — QR login SSE proxy (backend owns the Redis subscription).
// Canonical: apps/frontend/app/auth/qr/[token]/stream/route.ts
import { NextRequest } from 'next/server';
import { backendBaseUrl } from '../../../../../lib/auth-cookies';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(req: NextRequest, context: { params: Promise<{ token: string }> }): Promise<Response> {
  const { token } = await context.params;
  if (!UUID_RE.test(token)) return new Response('Invalid token', { status: 400 });

  let upstream: Response;
  try {
    upstream = await fetch(`${backendBaseUrl()}/api/v1/auth/qr/${token}/stream`, {
      headers: { Accept: 'text/event-stream' },
      signal: req.signal,
      cache: 'no-store',
    });
  } catch {
    return new Response('Backend unavailable', { status: 502 });
  }
  if (!upstream.ok || !upstream.body) return new Response('Upstream error', { status: upstream.status });

  return new Response(upstream.body, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}