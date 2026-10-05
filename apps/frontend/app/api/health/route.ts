// SSOT Phase 001 §6 — frontend health route
import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json({ status: 'ok', engine: 'Next.js 15 App Router' });
}
