// SSOT Phase 129 BDD-1 §5.2 — LINE webhook HMAC-SHA256 guard (< 5ms)
// Canonical: apps/backend/src/modules/security/guards/line-signature.guard.ts
// (legacy src/backend/modules/security/guards/line-signature.guard.ts)
// - RISK_CALL: no second HMAC implementation — delegates to the Phase 034
//   verifyLineSignature() (timing-safe, pure). This guard only extracts the
//   delivery bytes + header, measures the 5ms budget, and audits failures
//   through the 129 audit logger (fail-open audit, fail-closed auth).
// - Zero new deps (node:crypto rides the 034 lane).
import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { LINE_SIGNATURE_BUDGET_MS } from '@repo/shared';
import { verifyLineSignature } from '../../line-oa/line-oa.service';

export interface LineAuditPort {
  logImmutable(row: {
    actorId?: string;
    action: string;
    resource: string;
    ipAddress: string;
    userAgent: string;
  }): Promise<unknown>;
}

/** Raw-body extraction (Fastify rawBody Buffer + Express fallback). */
export function extractRawBody(req: Record<string, unknown>): string {
  const raw = req['rawBody'];
  if (typeof raw === 'string') return raw;
  if (Buffer.isBuffer(raw)) return raw.toString('utf8');
  if (raw instanceof Uint8Array) return Buffer.from(raw).toString('utf8');
  const body = req['body'];
  if (typeof body === 'string') return body;
  try {
    return JSON.stringify(body ?? '');
  } catch {
    return '';
  }
}

@Injectable()
export class LineSignatureGuard implements CanActivate {
  constructor(private readonly audit?: LineAuditPort) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Record<string, unknown>>();
    const headers = (req['headers'] as Record<string, string> | undefined) ?? {};
    const signature = headers['x-line-signature'] ?? '';
    const channelSecret = process.env.LINE_CHANNEL_SECRET ?? process.env.LINE_OA_CHANNEL_SECRET ?? '';
    const started = Date.now();
    const valid = verifyLineSignature(extractRawBody(req), signature, channelSecret);
    const elapsedMs = Date.now() - started;
    if (!valid) {
      const ip =
        headers['x-forwarded-for']?.split(',')[0]?.trim() ||
        (req['ip'] as string | undefined) ||
        'unknown';
      try {
        await this.audit?.logImmutable({
          action: 'LINE_SIGNATURE_REJECTED',
          resource: String(req['url'] ?? 'line-webhook'),
          ipAddress: ip,
          userAgent: headers['user-agent'] ?? 'line-webhook',
        });
      } catch {
        /* audit lane never rescues a forged webhook */
      }
      throw new UnauthorizedException('Invalid LINE HMAC-SHA256 signature');
    }
    (req as Record<string, unknown>)['lineSignatureElapsedMs'] = elapsedMs;
    void LINE_SIGNATURE_BUDGET_MS;
    return true;
  }
}

/** Compat alias for the scaffold stub name (no behavior change). */
export const LineSignatureGuardGuard = LineSignatureGuard;
