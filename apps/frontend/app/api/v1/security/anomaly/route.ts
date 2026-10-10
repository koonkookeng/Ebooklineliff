// SSOT Phase 120 — anomaly GraphQL passthrough proxy (fixed documents).
// Canonical: apps/frontend/app/api/v1/security/anomaly/route.ts
// RISK_CALL: single extra route (not in the phase file list) — without it
// the IN_SCOPE page cannot reach the IN_SCOPE GQL intents, because no REST
// controller is in scope and no /graphql rewrite exists in this repo. The
// proxy only forwards allow-listed operations with fixed query documents
// (variables-only user input; no string interpolation).
import { NextResponse } from 'next/server';

const QUERIES: Record<string, string> = {
  history: `query History($limit: Int) { myLoginHistory(limit: $limit) { id ipAddress city countryCode riskLevel riskScore anomalyType createdAt } }`,
  queue: `query Queue($page: Int, $limit: Int) { anomalyQueue(page: $page, limit: $limit) { items { id ipAddress city riskLevel riskScore } page limit } }`,
};

const MUTATIONS: Record<string, string> = {
  report: `mutation Report($ipAddress: String!, $userAgent: String!, $deviceFingerprint: String!) { reportLoginEvent(ipAddress: $ipAddress, userAgent: $userAgent, deviceFingerprint: $deviceFingerprint) { actionRequired riskScore riskLevel anomalyType logId elapsedMs } }`,
  block: `mutation Block { blockOwnSession }`,
};

export async function POST(req: Request) {
  const backend = process.env.BACKEND_URL ?? 'http://localhost:4000';
  const tenant = new URL(req.url).searchParams.get('tenant') ?? 'default';
  const h: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/json', 'x-tenant-id': tenant };
  const auth = req.headers.get('authorization');
  const cookie = req.headers.get('cookie');
  const fwd = req.headers.get('x-forwarded-for');
  const ua = req.headers.get('user-agent');
  if (auth) h['authorization'] = auth;
  if (cookie) h['cookie'] = cookie;
  if (fwd) h['x-forwarded-for'] = fwd;
  if (ua) h['user-agent'] = ua;
  try {
    const body = (await req.json().catch(() => null)) as { operation?: string; params?: Record<string, unknown> } | null;
    const op = body?.operation ?? '';
    const params = body?.params ?? {};
    const query = QUERIES[op] ?? MUTATIONS[op];
    if (!query) return NextResponse.json({ message: 'Unknown operation' }, { status: 400 });
    // report fills network identity server-side where the proxy can.
    const variables = op === 'report'
      ? { ipAddress: fwd?.split(',')[0]?.trim() || '0.0.0.0', userAgent: ua || 'unknown', deviceFingerprint: String(params['deviceFingerprint'] ?? 'unknown'), ...params }
      : params;
    const res = await fetch(`${backend}/graphql`, { method: 'POST', headers: h, body: JSON.stringify({ query, variables }) });
    const json = (await res.json().catch(() => null)) as { data?: Record<string, unknown>; errors?: Array<{ message: string }> } | null;
    if (json?.errors?.length) return NextResponse.json({ message: json.errors[0]?.message ?? 'GraphQL error' }, { status: 422 });
    const key = Object.keys(json?.data ?? {})[0] ?? '';
    return NextResponse.json(json?.data?.[key] ?? null, { status: res.status });
  } catch {
    return NextResponse.json({ message: 'Anomaly service unavailable' }, { status: 503 });
  }
}
