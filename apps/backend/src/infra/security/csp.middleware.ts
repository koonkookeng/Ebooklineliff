// SSOT Phase 028 §5.2 — Strict CSP header injector with per-request nonce
// Canonical: apps/backend/src/infra/security/csp.middleware.ts
// (legacy src/backend/infra/security/csp.middleware.ts)
// - Directives are single-sourced from buildCspHeader() (@repo/shared §3.1);
//   this file only mints the nonce (node:crypto, 16 bytes) and sets headers.
// - Fastify-safe: works with both raw (setHeader) and wrapped (header) replies.
// - Zero new deps. Applied to all routes via SecurityModule.configure().
import { Injectable, NestMiddleware } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { buildCspHeader } from '@repo/shared';

interface HeaderSink {
  setHeader?: (name: string, value: string) => void;
  header?: (name: string, value: string) => unknown;
}

function setHeader(res: HeaderSink, name: string, value: string): void {
  if (typeof res.setHeader === 'function') res.setHeader(name, value);
  else if (typeof res.header === 'function') res.header(name, value);
}

/**
 * True when the request reached us over TLS (directly or via a trusted proxy).
 * Plain-HTTP local/dev traffic must not be told to upgrade to https://.
 */
function isSecureRequest(req: Record<string, unknown>): boolean {
  const headers = req['headers'] as Record<string, string | string[] | undefined> | undefined;
  const fwd = headers?.['x-forwarded-proto'];
  const proto = Array.isArray(fwd) ? fwd[0] : fwd;
  if (typeof proto === 'string' && proto.trim()) {
    return proto.split(',')[0]?.trim().toLowerCase() === 'https';
  }
  if (typeof req['protocol'] === 'string') return req['protocol'] === 'https';
  const socket = req['socket'] as { encrypted?: boolean } | undefined;
  return Boolean(socket?.encrypted);
}

export function mintCspNonce(): string {
  return randomBytes(16).toString('base64');
}

@Injectable()
export class ContentSecurityPolicyMiddleware implements NestMiddleware {
  use(req: Record<string, unknown>, res: HeaderSink, next: () => void): void {
    const nonce = mintCspNonce();
    req['cspNonce'] = nonce;
    const secure = isSecureRequest(req);
    setHeader(res, 'Content-Security-Policy', buildCspHeader({ nonce, allowInsecure: !secure }));
    setHeader(res, 'X-Content-Type-Options', 'nosniff');
    // HSTS is meaningless (and ignored by browsers) over plain HTTP; only
    // advertise it once the request actually arrived over TLS.
    if (secure) setHeader(res, 'Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
    setHeader(res, 'Cross-Origin-Resource-Policy', 'cross-origin');
    setHeader(res, 'Referrer-Policy', 'strict-origin-when-cross-origin');
    next();
  }
}
