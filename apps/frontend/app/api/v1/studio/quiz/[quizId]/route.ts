// SSOT Phase 078 BDD-3 — Quiz delete proxy (auth passthrough)
// Canonical: apps/frontend/app/api/v1/studio/quiz/[quizId]/route.ts
import { NextResponse } from 'next/server';

export async function DELETE(req: Request, ctx: { params: { quizId: string } }) {
  const backend = process.env.BACKEND_URL ?? 'http://localhost:4000';
  const tenant = new URL(req.url).searchParams.get('tenant') ?? 'default';
  const headers: Record<string, string> = { Accept: 'application/json', 'x-tenant-id': tenant };
  const auth = req.headers.get('authorization');
  const cookie = req.headers.get('cookie');
  if (auth) headers['authorization'] = auth;
  if (cookie) headers['cookie'] = cookie;
  try {
    const res = await fetch(
      `${backend}/api/v1/studio/quiz/${encodeURIComponent(ctx.params.quizId)}`,
      { method: 'DELETE', headers },
    );
    return NextResponse.json(await res.json().catch(() => null), { status: res.status });
  } catch {
    return NextResponse.json({ message: 'Studio service unavailable' }, { status: 503 });
  }
}
