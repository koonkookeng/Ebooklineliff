// SSOT Phase 127 §8.1/Gate 8 — immutable security audit logger (OWASP A09)
// Canonical: apps/backend/src/modules/security/services/security-audit-logger.service.ts
// (legacy src/backend/modules/security/services/security-audit-logger.service.ts)
// - Single writer into SecurityAuditLog (§4.1 threat lanes) + fan-out to the
//   Redis SIEM stream. Fail-open: audit never breaks the request path.
// - PII discipline: payloadSnippet capped at 1000 chars, no secrets.
// - Ports-based (tsx-importable); wired via useFactory in DeviceSecurityModule.
// - Zero new deps.
import { Injectable } from '@nestjs/common';
import {
  SECURITY_EVENT_STREAM,
  capSnippet,
  type ThreatSeverity,
} from '@repo/shared';

export interface AuditDbPort {
  securityAuditLog: {
    create(args: { data: Record<string, unknown> }): Promise<unknown>;
  };
}

export interface AuditStreamPort {
  xaddPipeline(streamKey: string, batch: Array<Record<string, string | number>>): Promise<void>;
}

export interface SecurityIncidentRow {
  tenantId?: string;
  userId?: string | null;
  userIdHash?: string | null;
  ipAddress: string;
  userAgent: string;
  endpoint: string;
  threatType: string;
  severity: ThreatSeverity;
  payloadSnippet?: string;
  isBlocked?: boolean;
}

@Injectable()
export class SecurityAuditLoggerService {
  constructor(
    private readonly db: AuditDbPort,
    private readonly stream?: AuditStreamPort,
  ) {}

  /** Guard/WAF audit port shape (subset of the full row). */
  async logIncident(row: {
    userId?: string;
    ipAddress: string;
    userAgent: string;
    endpoint: string;
    threatType: string;
    severity: ThreatSeverity;
    payloadSnippet?: string;
  }): Promise<void> {
    await this.record({ ...row, userId: row.userId ?? null });
  }

  async record(row: SecurityIncidentRow): Promise<void> {
    const snippet = row.payloadSnippet ? capSnippet(row.payloadSnippet) : null;
    try {
      await this.db.securityAuditLog.create({
        data: {
          tenantId: row.tenantId ?? null,
          userId: row.userId ?? null,
          action: row.threatType,
          requiredScope: row.endpoint,
          providedScopes: [],
          granted: false,
          ipAddress: row.ipAddress,
          userAgent: row.userAgent.slice(0, 500),
          endpoint: row.endpoint,
          threatType: row.threatType,
          severity: row.severity,
          payloadSnippet: snippet,
          isBlocked: row.isBlocked ?? true,
          eventType: row.threatType,
          metadata: row.userIdHash ? { userIdHash: row.userIdHash } : undefined,
        },
      });
    } catch {
      /* fail-open: audit row loss never breaks the request path */
    }
    try {
      await this.stream?.xaddPipeline(SECURITY_EVENT_STREAM, [
        {
          ip: row.ipAddress,
          endpoint: row.endpoint,
          threatType: row.threatType,
          severity: row.severity,
          at: Date.now(),
        },
      ]);
    } catch {
      /* stream fan-out is best-effort */
    }
  }
}

/** Compat alias for the scaffold stub name (no behavior change). */
export const SecurityAuditLoggerServiceService = SecurityAuditLoggerService;
