// SSOT Phase 051 §8.1 — preview content-key proxy (binary, no-store, never logged).
// Canonical: apps/frontend/app/api/v1/preview/video/key/route.ts
import { NextResponse } from 'next/server';

export async function GET(req: Request) {
  const backend = process.env.BACKEND_URL ?? 'http://localhost:4000';
  const url = new URL(req.url);
  const lessonId = url.searchParams.get('lessonId');
  const token = url.searchParams.get('token');
  if (!lessonId || !token) {
    return NextResponse.json({ message: 'Missing preview key request' }, { status: 400 });
  }
  try {
    const res = await fetch(
      `${backend}/api/v1/preview/video/key?lessonId=${encodeURIComponent(lessonId)}&token=${encodeURIComponent(token)}`,
    );
    if (!res.ok) return new Response('Key unavailable', { status: res.status });
    const bytes = await res.arrayBuffer();
    return new Response(bytes, {
      status: 200,
      headers: { 'Content-Type': 'application/octet-stream', 'Cache-Control': 'no-store' },
    });
  } catch {
    return NextResponse.json({ message: 'Preview service unavailable' }, { status: 503 });
  }
}
