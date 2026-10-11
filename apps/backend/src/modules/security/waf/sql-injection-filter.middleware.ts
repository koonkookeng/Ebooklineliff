// SSOT Phase 127 §8.1 — SQL-injection WAF pre-filter (OWASP A03:2021)
// Canonical: apps/backend/src/modules/security/waf/sql-injection-filter.middleware.ts
// (legacy src/backend/modules/security/waf/sql-injection-filter.middleware.ts)
// - Prisma prepared statements are the real guard; this middleware is the
//   cheap edge tripwire: scans body/query/params strings with the shared
//   looksLikeSqlInjection() signals, 403s on hit, audit-logs fail-open.
// - Pure scanSqlInjectionInput() exported for contract tests. Zero new deps.
import { ForbiddenException, Injectable, NestMiddleware } from '@nestjs/common';
import { capSnippet, looksLikeSqlInjection } from '@repo/shared';

export interface WafAuditPort {
  logIncident(row: {
    ipAddress: string;
    userAgent: string;
    endpoint: string;
    threatType: string;
    severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
    payloadSnippet?: string;
  }): Promise<void>;
}

/** Collect string leaves (depth-capped) for signal scanning. */
export function scanSqlInjectionInput(input: unknown, depth = 0): string | null {
  if (depth > 4) return null;
  if (typeof input === 'string') return looksLikeSqlInjection(input) ? input : null;
  if (Array.isArray(input)) {
    for (const item of input) {
      const hit = scanSqlInjectionInput(item, depth + 1);
      if (hit) return hit;
    }
    return null;
  }
  if (input && typeof input === 'object') {
    for (const value of Object.values(input as Record<string, unknown>)) {
      const hit = scanSqlInjectionInput(value, depth + 1);
      if (hit) return hit;
    }
  }
  return null;
}

@Injectable()
export class SqlInjectionFilterMiddleware implements NestMiddleware {
  constructor(private readonly audit?: WafAuditPort) {}

  async use(
    req: Record<string, unknown>,
    _res: unknown,
    next: (err?: unknown) => void,
  ): Promise<void> {
    const hit =
      scanSqlInjectionInput(req['body']) ??
      scanSqlInjectionInput(req['query']) ??
      scanSqlInjectionInput(req['params']);
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
        threatType: 'SQL_INJECTION',
        severity: 'CRITICAL',
        payloadSnippet: capSnippet(hit),
      });
    } catch {
      /* audit lane never breaks the request path */
    }
    next(new ForbiddenException('Request blocked by input security policy.'));
  }
}
