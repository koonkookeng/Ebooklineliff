// SSOT Phase 115 Task 6 §8.1 — hash-chain audit service (tamper-evident)
// Canonical: apps/backend/src/modules/reconciliation/services/audit-chain.service.ts
// (legacy src/backend/modules/reconciliation/services/audit-chain.service.ts)
// - H_n = SHA-256(H_{n-1} | statementId | orderId | initiatedBy | ts).
//   Head pointer lives in Redis per tenant (`recon:audit-head:<t>`, 10y TTL,
//   fail-open GENESIS on outage). verifyChain replays stored override rows
//   in createdAt order and reports the first break (fail-closed verdict).
// - Zero new deps.
import { Injectable, Logger } from '@nestjs/common';
import { RECON_GENESIS_HASH, chainStep } from '@repo/shared';
import { RedisClusterService } from '../../../infra/redis/redis-cluster.service';

/** Head pointer TTL: effectively persistent (Redis has no plain SET here). */
export const AUDIT_HEAD_TTL_SEC = 10 * 365 * 24 * 60 * 60;

export function auditHeadKey(tenantId: string): string {
  return `recon:audit-head:${tenantId}`;
}

export interface ChainRow {
  statementId: string;
  orderId: string;
  initiatedBy: string;
  createdAt: Date;
  auditHash: string;
}

@Injectable()
export class AuditChainService {
  private readonly logger = new Logger(AuditChainService.name);

  constructor(private readonly redis: RedisClusterService) {}

  async head(tenantId: string): Promise<string> {
    try {
      return (await this.redis.get(auditHeadKey(tenantId))) ?? RECON_GENESIS_HASH;
    } catch (err) {
      this.logger.warn(`Audit head fail-open for ${tenantId}: ${(err as Error).message}`);
      return RECON_GENESIS_HASH;
    }
  }

  /** Mint the next link and advance the head (call AFTER commit). */
  async mint(tenantId: string, args: { statementId: string; orderId: string; initiatedBy: string; timestamp: string }): Promise<string> {
    const prev = await this.head(tenantId);
    const next = chainStep(prev, args);
    try {
      await this.redis.setex(auditHeadKey(tenantId), AUDIT_HEAD_TTL_SEC, next);
    } catch (err) {
      this.logger.warn(`Audit head persist failed for ${tenantId}: ${(err as Error).message}`);
    }
    return next;
  }

  /** Replay rows oldest-first; fail-closed break report. */
  verify(rows: ChainRow[]): { valid: boolean; checked: number; brokenAt?: number } {
    const ordered = [...rows].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    let prev = RECON_GENESIS_HASH;
    for (let i = 0; i < ordered.length; i++) {
      const r = ordered[i]!;
      const expect = chainStep(prev, {
        statementId: r.statementId,
        orderId: r.orderId,
        initiatedBy: r.initiatedBy,
        timestamp: r.createdAt.toISOString(),
      });
      if (expect !== r.auditHash) return { valid: false, checked: i, brokenAt: i };
      prev = r.auditHash;
    }
    return { valid: true, checked: ordered.length };
  }
}
