// SSOT Phase 118 Task 3 — audit repository (create-only structural adapter)
// Canonical: apps/backend/src/modules/audit-log/infrastructure/audit-log.repository.ts
// (legacy src/backend/modules/audit-log/infrastructure/audit-log.repository.ts)
// - CREATE + reads only: no update/delete surface exists (append-only is
//   structural, not just documented — asserted in 118 tests). Follows the
//   PrismaKycStore precedent (085 §5.1).
// - Zero new deps.
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../infra/database/prisma.service';

type PrismaAny = {
  auditLog: {
    create(a: unknown): Promise<unknown>;
    findFirst(a: unknown): Promise<unknown>;
    findMany(a: unknown): Promise<unknown[]>;
    count(a: unknown): Promise<number>;
  };
  auditVaultSyncState: {
    findFirst(a: unknown): Promise<unknown>;
    create(a: unknown): Promise<unknown>;
  };
};

@Injectable()
export class AuditLogRepository {
  constructor(private readonly prisma: PrismaService) {}

  private get db(): PrismaAny {
    return this.prisma as unknown as PrismaAny;
  }

  append(data: Record<string, unknown>): Promise<unknown> {
    return this.db.auditLog.create({ data });
  }

  latest(): Promise<Record<string, unknown> | null> {
    return (this.db.auditLog.findFirst({ orderBy: { sequenceNumber: 'desc' } }).catch(() => null)) as Promise<Record<string, unknown> | null>;
  }

  list(args: { actorId?: string; actionCategory?: string; integrityStatus?: string; skip: number; take: number }): Promise<Record<string, unknown>[]> {
    const where: Record<string, unknown> = {};
    if (args.actorId) where['actorId'] = args.actorId;
    if (args.actionCategory) where['actionCategory'] = args.actionCategory;
    if (args.integrityStatus) where['integrityStatus'] = args.integrityStatus;
    return (this.db.auditLog.findMany({ where, orderBy: { sequenceNumber: 'desc' }, skip: args.skip, take: args.take }).catch(() => [])) as Promise<
      Record<string, unknown>[]
    >;
  }

  count(where: Record<string, unknown>): Promise<number> {
    return this.db.auditLog.count({ where }).catch(() => 0);
  }

  window(skip: number, take: number): Promise<Record<string, unknown>[]> {
    return (this.db.auditLog.findMany({ orderBy: { sequenceNumber: 'asc' }, skip, take }).catch(() => [])) as Promise<Record<string, unknown>[]>;
  }

  syncState(): Promise<Record<string, unknown> | null> {
    return (this.db.auditVaultSyncState.findFirst({ orderBy: { syncedAt: 'desc' } }).catch(() => null)) as Promise<Record<string, unknown> | null>;
  }

  recordSyncState(data: { lastSyncedSequence: number | bigint; lastSyncedHash: string; r2ObjectKey: string }): Promise<unknown> {
    return this.db.auditVaultSyncState.create({ data });
  }
}
