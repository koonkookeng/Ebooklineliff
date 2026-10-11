// SSOT Phase 129 Gate 2 — PDPA granular-consent strict gate
// Canonical: apps/backend/src/modules/security/guards/pdpa-consent.guard.ts
// (legacy src/backend/modules/security/guards/pdpa-consent.guard.ts)
// - Mandatory purposes (NECESSARY_TERMS @ current PDPA_CONSENT_VERSION)
//   must be granted; otherwise 403 PDPA_CONSENT_REQUIRED so the LIFF client opens the CONSENT_REQUIRED bottom sheet instead of
//   silently serving content. Consent truth comes from ConsentManagerService
//   (edge-first); guard fails-closed on unknown status.
// - Ports-based (tsx-importable). Zero new deps.
import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { PDPA_CONSENT_VERSION, hasMandatoryConsent } from '@repo/shared';

export interface ConsentStatusPort {
  acceptedPurposes(userId: string): Promise<{ purposes: string[]; version: string } | null>;
}

@Injectable()
export class PdpaConsentGuard implements CanActivate {
  constructor(private readonly consents: ConsentStatusPort) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Record<string, unknown>>();
    const user = (req['user'] as { id?: string } | undefined) ?? {};
    const lineProfile = (req['lineProfile'] as { sub?: string } | undefined) ?? {};
    const userId = user.id ?? lineProfile.sub;
    if (!userId) throw new ForbiddenException('PDPA_CONSENT_REQUIRED');
    const status = await this.consents.acceptedPurposes(userId).catch(() => null);
    if (!status || status.version !== PDPA_CONSENT_VERSION) {
      throw new ForbiddenException('PDPA_CONSENT_REQUIRED');
    }
    if (!hasMandatoryConsent(status.purposes)) {
      throw new ForbiddenException('PDPA_CONSENT_REQUIRED');
    }
    return true;
  }
}

/** Compat alias for the scaffold stub name (no behavior change). */
export const PdpaConsentGuardGuard = PdpaConsentGuard;
