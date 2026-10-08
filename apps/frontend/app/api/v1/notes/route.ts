// SSOT Phase 065 Task 4 — notes CRUD proxy (JWT passthrough).
// Canonical: apps/frontend/app/api/v1/notes/route.ts
import { NextResponse } from 'next/server';

function authHeaders(req: Request, json: boolean): Record<string, string> {
  const h: Record<string, string> = {};
  if (json) h['content-type'] = 'application/json';
  const auth = req.headers.get('authorization');
  const cookie = req.headers.get('cookie');
  if (auth) h['authorization'] = auth;
  if (cookie) h['cookie'] = cookie;
  return h;
}

export async function GET(req: Request) {
  const backend = process.env.BACKEND_URL ?? 'http://localhost:4000';
  const lessonId = new URL(req.url).searchParams.get('lessonId');
  if (!lessonId) return NextResponse.json({ message: 'Missing lesson id' }, { status: 400 });
  try {
    const res = await fetch(`${backend}/api/v1/notes?lessonId=${encodeURIComponent(lessonId)}`, {
      headers: authHeaders(req, false),
    });
    const data = await res.json().catch(() => null);
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ message: 'Note service unavailable' }, { status: 503 });
  }
}

async function forward(req: Request, method: string, suffix = ''): Promise<NextResponse> {
  const backend = process.env.BACKEND_URL ?? 'http://localhost:4000';
  const body = await req.json().catch(() => null);
  const query = new URL(req.url).search;
  try {
    const res = await fetch(`${backend}/api/v1/notes${suffix}${query}`, {
      method,
      headers: authHeaders(req, true),
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => null);
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ message: 'Note service unavailable' }, { status: 503 });
  }
}

export async function POST(req: Request): Promise<NextResponse> {
  return forward(req, 'POST');
}

export async function PATCH(req: Request): Promise<NextResponse> {
  return forward(req, 'PATCH');
}

export async function DELETE(req: Request): Promise<NextResponse> {
  return forward(req, 'DELETE');
}
