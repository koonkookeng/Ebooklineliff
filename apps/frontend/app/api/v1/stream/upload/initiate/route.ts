// SSOT Phase 043 — Stream proxies (JWT passthrough, Phase 014 pattern)
// Canonical: apps/frontend/app/api/v1/stream/*/route.ts
// - upload/initiate|complete (POST), upload/[videoId]/status (GET),
//   upload/webhook (worker secret, no auth forward), manifest (GET),
//   key (GET, binary no-store), progress (POST).
import { NextResponse } from 'next/server';

function backend(): string {
  return process.env.BACKEND_URL ?? 'http://localhost:4000';
}

function authHeaders(req: Request, json: boolean): Record<string, string> {
  const h: Record<string, string> = {};
  if (json) h['content-type'] = 'application/json';
  const auth = req.headers.get('authorization');
  const cookie = req.headers.get('cookie');
  if (auth) h['authorization'] = auth;
  if (cookie) h['cookie'] = cookie;
  return h;
}

async function relayJson(res: Response): Promise<NextResponse> {
  const data = await res.json().catch(() => null);
  return NextResponse.json(data, { status: res.status });
}

async function postJson(req: Request, path: string, allowEmptyBody = false): Promise<NextResponse> {
  const body = await req.json().catch(() => null);
  if (!allowEmptyBody && (!body || typeof body !== 'object')) {
    return NextResponse.json({ message: 'Invalid request body' }, { status: 400 });
  }
  try {
    const res = await fetch(`${backend()}${path}`, { method: 'POST', headers: authHeaders(req, true), body: JSON.stringify(body) });
    return relayJson(res);
  } catch {
    return NextResponse.json({ message: 'Stream service unavailable' }, { status: 503 });
  }
}

export async function POST(req: Request) {
  return postJson(req, '/api/v1/stream/upload/initiate');
}
