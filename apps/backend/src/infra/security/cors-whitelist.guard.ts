// SSOT Phase 028 §5.1 — Domain whitelist guard for NestJS API (HLS isolation)
// Canonical: apps/backend/src/infra/security/cors-whitelist.guard.ts
// (legacy src/backend/infra/security/cors-whitelist.guard.ts)
// - Allows requests WITHOUT Origin/Referer (LIFF WebView navigations, beacons,
//   curl health checks carry none); enforces the whitelist only when the client
//   declares an origin (fetch/XHR preflight path — the exfiltration vector).
// - Wildcard-aware via isOriginWhitelisted() (@repo/shared §3.1).
// - Compiled default list mirrors config/line-developers-whitelist.json; the
//   Prisma DomainWhitelistRegistry is the console-registration source of truth
//   (Task 6) — sync the constant when the registry changes (parity-tested).
// - Zero new deps. 403 carries no allowlist disclosure (opaque message).
import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { isOriginWhitelisted } from '@repo/shared';

/** Compiled from config/line-developers-whitelist.json (default tenant). */
export const DEFAULT_WHITELISTED_ORIGINS: string[] = [
  'https://liff.omnichannel.com',
  'https://app.omnichannel.com',
  'https://api.omnichannel.com',
  'https://cdn.omnichannel.com',
  'https://videocdn.omnichannel.com',
  'https://static.line-scdn.net',
  'https://*.line-scdn.net',
  'https://liff.line.me',
  'https://*.line.me',
  'https://access.line.me',
  'https://api.line.me',
];

interface GuardRequest {
  headers?: Record<string, string | string[] | undefined>;
}

function first(headers: GuardRequest['headers'], name: string): string | undefined {
  const v = headers?.[name] ?? headers?.[name.toLowerCase()];
  const s = Array.isArray(v) ? v[0] : v;
  return typeof s === 'string' && s ? s : undefined;
}

@Injectable()
export class CorsWhitelistGuard implements CanActivate {
  constructor(private readonly whitelist: string[] = DEFAULT_WHITELISTED_ORIGINS) {}

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<GuardRequest>();
    const origin = first(req.headers, 'origin') ?? first(req.headers, 'referer');
    // No declared origin (navigation/beacon/health): nothing to enforce.
    if (!origin) return true;
    let normalized = origin;
    try {
      const url = new URL(origin);
      normalized = url.origin;
    } catch {
      // Referer paths collapse to origin; garbage stays as-is (fails closed).
      normalized = origin.split('/').slice(0, 3).join('/');
    }
    if (isOriginWhitelisted(normalized, this.whitelist)) return true;
    throw new ForbiddenException('Cross-origin request blocked by security policy');
  }
}
