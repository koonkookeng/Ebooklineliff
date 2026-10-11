// SSOT Phase 127 §8.1 — XSS sanitizer WAF pre-filter (OWASP A03:2021)
// Canonical: apps/backend/src/modules/security/waf/xss-sanitizer.middleware.ts
// (legacy src/backend/modules/security/waf/xss-sanitizer.middleware.ts)
// - Output-encoding at the renderer is the real guard; this middleware is
//   the cheap edge tripwire: scans body/query/params strings with the shared
//   looksLikeXss() signals, 403s on hit, audit-logs fail-open.
// - Pure scanXssInput() exported for contract tests. Zero new deps.
import { ForbiddenException, Injectable, NestMiddleware } from '@nestjs/common';
import { capSnippet, looksLikeXss } from '@repo/shared';
import type { WafAuditPort } from './sql-injection-filter.middleware';

/** Collect string leaves (depth-capped) for signal scanning. */
export function scanXssInput(input: unknown, depth = 0): string | null {
  if (depth > 4) return null;
  if (typeof input === 'string') return looksLikeXss(input) ? input : null;
  if (Array.isArray(input)) {
    for (const item of input) {
      const hit = scanXssInput(item, depth + 1);
      if (hit) return hit;
    }
    return null;
  }
  if (input && typeof input === 'object') {
    for (const value of Object.values(input as Record<string, unknown>)) {
      const hit = scanXssInput(value, depth + 1);
      if (hit) return hit;
    }
  }
  return null;
}

@Injectable()
export class XssSanitizerMiddleware implements NestMiddleware {
  constructor(private readonly audit?: WafAuditPort) {}

  async use(
    req: Record<string, unknown>,
    _res: unknown,
    next: (err?: unknown) => void,
  ): Promise<void> {
    const hit =
      scanXssInput(req['body']) ?? scanXssInput(req['query']) ?? scanXssInput(req['params']);
    if (!hit) {
      next();
      return;
    }
    const ip =
      ((req['headers'] as Record<string, string> | undefined)?.['x-forwarded-for']?.split(',')[0]?.trim()) ||
      (req['ip'] as string | undefined) ||
      'unknown';
    try {
      await this.audit?.logIncident({
        ipAddress: ip,
        userAgent: String((req['headers'] as Record<string, string> | undefined)?.['user-agent'] ?? 'waf'),
        endpoint: String(req['url'] ?? req['originalUrl'] ?? 'unknown'),
        threatType: 'XSS',
        severity: 'HIGH',
        payloadSnippet: capSnippet(hit),
      });
    } catch {
      /* audit lane never breaks the request path */
    }
    next(new ForbiddenException('Request blocked by input security policy.'));
  }
}
