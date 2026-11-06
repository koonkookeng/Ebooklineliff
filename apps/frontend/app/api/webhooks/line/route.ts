// LINE Messaging API webhook — public proxy to the NestJS backend.
// LINE signs the *raw* body with the channel secret, so forward it byte-for-byte
// and let the backend guards verify X-Line-Signature.
//
// Two backend handlers exist and both are safe for any event batch:
//   /messaging — Phase 004 ACK path (no side effects)
//   /oa        — Phase 034 follow/unfollow friendship sync
// Deliver to both so follow events are never dropped; LINE only checks the status.
import { NextRequest, NextResponse } from 'next/server';

const BACKEND_URL =
  process.env.BACKEND_URL ??
  process.env.NEXT_PUBLIC_BACKEND_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  'http://localhost:4000';

// Backend applies a global prefix (main.ts: app.setGlobalPrefix('api/v1')).
const BASE = `${BACKEND_URL.replace(/\/$/, '')}/api/v1/webhooks/line`;
const MESSAGING_TARGET = `${BASE}/messaging`;
const OA_TARGET = `${BASE}/oa`;

interface ForwardResult {
  status: number;
  body: string;
  contentType: string;
}

async function forward(
  target: string,
  body: string,
  signature: string,
  contentType: string,
): Promise<ForwardResult> {
  try {
    const res = await fetch(target, {
      method: 'POST',
      headers: {
        'Content-Type': contentType,
        'X-Line-Signature': signature,
      },
      body,
      cache: 'no-store',
    });
    return {
      status: res.status,
      body: await res.text(),
      contentType: res.headers.get('content-type') ?? 'application/json',
    };
  } catch (err) {
    return {
      status: 502,
      body: JSON.stringify({ error: 'BACKEND_UNREACHABLE', detail: String(err) }),
      contentType: 'application/json',
    };
  }
}

export async function POST(req: NextRequest) {
  const body = await req.text();
  const signature = req.headers.get('x-line-signature') ?? '';
  const contentType = req.headers.get('content-type') ?? 'application/json';

  const [messaging, oa] = await Promise.all([
    forward(MESSAGING_TARGET, body, signature, contentType),
    forward(OA_TARGET, body, signature, contentType),
  ]);

  // Success only when both handlers accepted the delivery, otherwise return the
  // failing status so LINE retries the webhook delivery.
  const failed = [messaging, oa].find((r) => r.status < 200 || r.status >= 300);
  const result = failed ?? messaging;
  return new NextResponse(result.body, {
    status: result.status,
    headers: { 'Content-Type': result.contentType },
  });
}

export function GET() {
  return NextResponse.json({ ok: true, endpoint: '/api/webhooks/line' });
}
