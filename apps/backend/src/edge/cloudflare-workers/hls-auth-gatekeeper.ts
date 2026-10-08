// SSOT Phase 053 §8.1 — Cloudflare edge gatekeeper (token verify in front of R2)
// Canonical: apps/backend/src/edge/cloudflare-workers/hls-auth-gatekeeper.ts
// (legacy src/edge/cloudflare-workers/hls-auth-gatekeeper.ts)
// - Verifies base64url(userId:lessonId:sessionId:ipHash:exp:signature) with
//   WebCrypto HMAC-SHA256 (<50ms budget, §10) + expiry + IP binding.
// - Error taxonomy (§1.3 BDD): missing → MISSING_HLS_TOKEN, expired →
//   HLS_TOKEN_EXPIRED, bad signature/IP → INVALID_OR_EXPIRED_HLS_TOKEN.
// - Success streams bytes straight from R2 (zero egress); 403s are never cached.
export interface R2ObjectBodyLike {
  readonly body: ReadableStream;
  writeHttpMetadata(headers: Headers): void;
  readonly httpEtag: string;
}

export interface R2BucketLike {
  get(key: string): Promise<R2ObjectBodyLike | null>;
}

export interface Env {
  HLS_HMAC_SECRET: string;
  R2_BUCKET: R2BucketLike;
}

const JSON_HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };

function forbidden(error: string): Response {
  return new Response(JSON.stringify({ error }), { status: 403, headers: JSON_HEADERS });
}

function b64urlDecode(token: string): string {
  const b64 = token.replace(/-/g, '+').replace(/_/g, '/');
  const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4));
  return atob(b64 + pad);
}

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}

type VerifyVerdict = 'OK' | 'EXPIRED' | 'INVALID';

async function verifyHmacToken(token: string, secret: string, clientIp: string): Promise<VerifyVerdict> {
  try {
    const parts = b64urlDecode(token).split(':');
    if (parts.length !== 6) return 'INVALID';
    const [userId, lessonId, sessionId, ipHash, expStr, signature] = parts;
    const exp = parseInt(expStr, 10);
    if (!userId || !lessonId || !sessionId || !ipHash || !signature || !Number.isInteger(exp) || exp <= 0) {
      return 'INVALID';
    }
    // Clock-skew grace (5s) mirrors the shared isHlsTokenExpired helper.
    if (Math.floor(Date.now() / 1000) > exp + 5) return 'EXPIRED';
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify'],
    );
    const ok = await crypto.subtle.verify(
      'HMAC',
      key,
      hexToBytes(signature),
      encoder.encode(`${userId}:${lessonId}:${sessionId}:${ipHash}:${expStr}`),
    );
    if (!ok) return 'INVALID';
    // IP binding (§1.3): recompute the 16-hex sha256 prefix of the edge-seen
    // client IP and require it to match the minted ipHash claim — a leaked
    // token replayed from another network fails closed here.
    if (clientIp) {
      const digest = await crypto.subtle.digest('SHA-256', encoder.encode(clientIp));
      const actual = Array.from(new Uint8Array(digest))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('')
        .substring(0, 16);
      if (actual !== ipHash) return 'INVALID';
    }
    return 'OK';
  } catch {
    return 'INVALID';
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const token = url.searchParams.get('token');
    if (!token) return forbidden('MISSING_HLS_TOKEN');

    const clientIp = request.headers.get('CF-Connecting-IP') || '';
    const verdict = await verifyHmacToken(token, env.HLS_HMAC_SECRET, clientIp);
    if (verdict === 'EXPIRED') return forbidden('HLS_TOKEN_EXPIRED');
    if (verdict !== 'OK') return forbidden('INVALID_OR_EXPIRED_HLS_TOKEN');

    const objectKey = url.pathname.replace(/^\//, '');
    const object = await env.R2_BUCKET.get(objectKey);
    if (!object) {
      return new Response('Segment Not Found', { status: 404, headers: { 'Cache-Control': 'no-store' } });
    }
    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set('etag', object.httpEtag);
    headers.set('Access-Control-Allow-Origin', '*');
    headers.set('Cache-Control', 'public, max-age=3600');
    return new Response(object.body, { headers });
  },
};
