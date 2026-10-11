// SSOT Phase 129 BDD-1 — LINE LIFF ID Token guard (issuer/audience/expiry)
// Canonical: apps/backend/src/modules/security/guards/line-liff-auth.guard.ts
// (legacy src/backend/modules/security/guards/line-liff-auth.guard.ts)
// - RISK_CALL: no second token verifier — delegates to the Phase 006
//   LineVerifierService (verify-endpoint primary, kid/expiry/audience
//   checks, 401 INVALID_LINE_TOKEN). This guard only extracts the bearer,
//   stamps req.lineProfile, and audits rejections (fail-open audit).
// - Zero new deps.
import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { LineVerifierService } from '../../auth/services/line-verifier.service';
import type { LineAuditPort } from './line-signature.guard';

export interface LineProfile {
  sub: string;
  name?: string;
  picture?: string;
  email?: string;
}

@Injectable()
export class LineLiffAuthGuard implements CanActivate {
  constructor(
    private readonly verifier: Pick<LineVerifierService, 'verifyIdToken'>,
    private readonly audit?: LineAuditPort,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Record<string, unknown>>();
    const headers = (req['headers'] as Record<string, string> | undefined) ?? {};
    const auth = headers['authorization'] ?? '';
    const idToken = auth.startsWith('Bearer ') ? auth.slice('Bearer '.length).trim() : '';
    if (!idToken) throw new UnauthorizedException('INVALID_LINE_TOKEN');
    try {
      const decoded = (await this.verifier.verifyIdToken(idToken)) as unknown as LineProfile;
      (req as Record<string, unknown>)['lineProfile'] = {
        sub: decoded.sub,
        ...(decoded.name ? { name: decoded.name } : {}),
        ...(decoded.picture ? { picture: decoded.picture } : {}),
        ...(decoded.email ? { email: decoded.email } : {}),
      };
      return true;
    } catch (err) {
      if (err instanceof UnauthorizedException) {
        const ip =
          headers['x-forwarded-for']?.split(',')[0]?.trim() ||
          (req['ip'] as string | undefined) ||
          'unknown';
        try {
          await this.audit?.logImmutable({
            action: 'LINE_ID_TOKEN_REJECTED',
            resource: String(req['url'] ?? 'liff-api'),
            ipAddress: ip,
            userAgent: headers['user-agent'] ?? 'liff',
          });
        } catch {
          /* audit lane never rescues a forged token */
        }
      }
      throw err instanceof Error ? err : new UnauthorizedException('INVALID_LINE_TOKEN');
    }
  }
}

/** Compat alias for the scaffold stub name (no behavior change). */
export const LineLiffAuthGuardGuard = LineLiffAuthGuard;
