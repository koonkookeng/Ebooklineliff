// SSOT Phase 127 BDD-1 §8.1 — DRM entitlement gatekeeper (OWASP A01 broken access)
// Canonical: apps/backend/src/modules/security/guards/drm-entitlement.guard.ts
// (legacy src/backend/modules/security/guards/drm-entitlement.guard.ts)
// - Direct R2 chunk/segment URL hits without a valid entitlement flag =>
//   403 + immutable SecurityAuditLog row (UNAUTHORIZED_DRM_ACCESS) +
//   attacker 24h throttle marker. Fail-closed on auth, fail-open on
//   Redis outage (readers stay up; 050/122 precedent).
// - Pure entitlementKey exported for contract tests. Zero new deps.
import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { ATTACKER_BLOCK_TTL_SEC, attackerBlockKey, SECURITY_EVENT_STREAM } from '@repo/shared';

export interface DrmEntitlementEdgePort {
  getEntitlementFlag(key: string): Promise<string | null>;
  setex?(key: string, ttlSeconds: number, value: string): Promise<void>;
  set?(key: string, value: string | Buffer, ...args: Array<string | number>): Promise<unknown>;
  expire?(key: string, seconds: number): Promise<void>;
  xaddPipeline?(streamKey: string, batch: Array<Record<string, string | number>>): Promise<void>;
}

export interface DrmAuditPort {
  logIncident(row: {
    userId?: string;
    ipAddress: string;
    userAgent: string;
    endpoint: string;
    threatType: string;
    severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
    payloadSnippet?: string;
  }): Promise<void>;
}

/** Edge flag key for a (user, product) entitlement grant. */
export function entitlementKey(userId: string, productId: string): string {
  return `entitlement:{${userId}}:${productId}`;
}

@Injectable()
export class DrmEntitlementGuard implements CanActivate {
  constructor(
    private readonly edge: DrmEntitlementEdgePort,
    private readonly audit?: DrmAuditPort,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest() as {
      user?: { id?: string };
      headers?: Record<string, string | undefined>;
      ip?: string;
      url?: string;
      params?: Record<string, string | undefined>;
      query?: Record<string, string | undefined>;
    };
    const userId = req.user?.id || req.headers?.['x-user-id'];
    const productId = req.params?.productId || req.query?.productId;
    const clientIp =
      req.headers?.['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || 'unknown';
    const endpoint = req.url || 'drm-chunk';
    if (!userId || !productId) {
      await this.record(clientIp, endpoint, 'UNAUTHORIZED_DRM_ACCESS', 'missing identity/scope');
      throw new ForbiddenException('Missing entitlement scope');
    }
    let flag: string | null = null;
    try {
      flag = await this.edge.getEntitlementFlag(entitlementKey(userId, productId));
    } catch {
      return true; // fail-open on cache outage (DB grant lanes stay authoritative)
    }
    if (flag) return true;
    await this.record(clientIp, endpoint, 'UNAUTHORIZED_DRM_ACCESS', `user=${userId} product=${productId}`);
    await this.throttle(clientIp);
    throw new ForbiddenException('No active entitlement for this content');
  }

  private async record(ip: string, endpoint: string, threatType: string, snippet: string): Promise<void> {
    try {
      await this.audit?.logIncident({
        ipAddress: ip,
        userAgent: 'drm-guard',
        endpoint,
        threatType,
        severity: 'HIGH',
        payloadSnippet: snippet.slice(0, 1000),
      });
      await this.edge.xaddPipeline?.(SECURITY_EVENT_STREAM, [
        { ip, endpoint, threatType, severity: 'HIGH', at: Date.now() },
      ]);
    } catch {
      /* audit lane never breaks the read path */
    }
  }

  private async throttle(ip: string): Promise<void> {
    try {
      if (this.edge.setex) await this.edge.setex(attackerBlockKey(ip), ATTACKER_BLOCK_TTL_SEC, '1');
      else if (this.edge.set) await this.edge.set(attackerBlockKey(ip), '1', 'EX', ATTACKER_BLOCK_TTL_SEC);
    } catch {
      /* best-effort */
    }
  }
}

/** Compat alias for the scaffold stub name (no behavior change). */
export const DrmEntitlementGuardGuard = DrmEntitlementGuard;
