// SSOT Phase 129 Gate 5 — tamper-evident immutable audit logger
// Canonical: apps/backend/src/modules/security/services/audit-logger.service.ts
// (legacy src/backend/modules/security/services/audit-logger.service.ts)
// - RISK_CALL: no second hash formula — chain links reuse the SSOT
//   auditBlockHash() (118 lane, SHA-256). Each ImmutableAuditLog row stores
//   hashChain = f(previous head + current payload); head lookup is a single
//   indexed latest-row read. Fail-open writer (audit never breaks product
//   paths); verifyWindow() replays oldest-first and reports the first break.
// - Ports-based (tsx-importable). Zero new deps.
import { Injectable } from '@nestjs/common';
import { AUDIT_GENESIS_HASH, auditBlockHash } from '@repo/shared';

export interface ImmutableAuditRow {
  id: string;
  actorId: string | null;
  action: string;
  resource: string;
  ipAddress: string;
  userAgent: string;
  previousData: unknown;
  newData: unknown;
  hashChain: string;
  createdAt: Date;
}

export interface ImmutableAuditDbPort {
  immutableAuditLog: {
    create(args: { data: Record<string, unknown> }): Promise<ImmutableAuditRow>;
    findFirst(args: Record<string, unknown>): Promise<ImmutableAuditRow | null>;
    findMany(args: Record<string, unknown>): Promise<ImmutableAuditRow[]>;
  };
}

export function immutableEntryHash(args: {
  actorId: string;
  action: string;
  previousData: unknown;
  newData: unknown;
  previousHash: string;
  timestamp: string;
}): string {
  return auditBlockHash({
    sequenceNumber: Date.parse(args.timestamp),
    actorId: args.actorId,
    actionName: args.action,
    payloadBefore: args.previousData,
    payloadAfter: args.newData,
    previousHash: args.previousHash,
    timestamp: args.timestamp,
  });
}

@Injectable()
export class AuditLoggerService {
  constructor(private readonly db: ImmutableAuditDbPort) {}

  async headHash(): Promise<string> {
    try {
      const latest = await this.db.immutableAuditLog.findFirst({ orderBy: { createdAt: 'desc' } });
      return latest?.hashChain ?? AUDIT_GENESIS_HASH;
    } catch {
      return AUDIT_GENESIS_HASH;
    }
  }

  /** Guard audit port shape (BDD-1 rejection events). */
  async logImmutable(row: {
    actorId?: string;
    action: string;
    resource: string;
    ipAddress: string;
    userAgent: string;
    previousData?: unknown;
    newData?: unknown;
  }): Promise<ImmutableAuditRow> {
    const timestamp = new Date().toISOString();
    const previousHash = await this.headHash();
    const hashChain = immutableEntryHash({
      actorId: row.actorId ?? 'system',
      action: row.action,
      previousData: row.previousData ?? null,
      newData: row.newData ?? { resource: row.resource },
      previousHash,
      timestamp,
    });
    return this.db.immutableAuditLog.create({
      data: {
        actorId: row.actorId ?? null,
        action: row.action,
        resource: row.resource,
        ipAddress: row.ipAddress,
        userAgent: row.userAgent,
        previousData: row.previousData ?? null,
        newData: row.newData ?? { resource: row.resource },
        hashChain,
        // The hashed timestamp doubles as createdAt so replay is exact
        // (Postgres timestamptz round-trips millisecond ISO losslessly).
        createdAt: new Date(timestamp),
      },
    });
  }

  /** Replay an oldest-first window; fail-closed break report. */
  async verifyChain(limit = 100): Promise<{ valid: boolean; checked: number; brokenAt?: string }> {
    const rows = await this.db.immutableAuditLog
      .findMany({ orderBy: { createdAt: 'asc' }, take: limit })
      .catch(() => []);
    let prev = AUDIT_GENESIS_HASH;
    let checked = 0;
    for (const row of rows) {
      const createdAt = row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt);
      const expect = immutableEntryHash({
        actorId: row.actorId ?? 'system',
        action: row.action,
        previousData: row.previousData,
        newData: row.newData,
        previousHash: prev,
        timestamp: createdAt,
      });
      if (expect !== row.hashChain) return { valid: false, checked, brokenAt: row.id };
      prev = row.hashChain;
      checked += 1;
    }
    return { valid: true, checked };
  }
}

/** Compat alias for the scaffold stub name (no behavior change). */
export const AuditLoggerServiceService = AuditLoggerService;
