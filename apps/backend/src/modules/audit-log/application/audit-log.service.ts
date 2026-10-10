// SSOT Phase 118 Task 3 §5.1/BDD-1 — audit append service (chain-linked)
// Canonical: apps/backend/src/modules/audit-log/application/audit-log.service.ts
// (legacy src/backend/modules/audit-log/application/audit-log.service.ts)
// - append: actor gate -> chain head (latest row, GENESIS on empty) ->
//   currentHash + HMAC sign (<2ms budget, measured) -> single CREATE that
//   mirrors BOTH lanes (109 userId/action/details + 118 actor/hash/signature)
//   -> stream -> best-effort WORM sink (batch of 1; the sweeper batches).
//   The repository exposes no update/delete (Gate 7 append-only).
// - verifyChain: oldest-first replay over a bounded window (fail-closed).
// - Zero new deps.
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { AUDIT_APPEND_BUDGET_MS, AUDIT_EVENT_STREAM, AUDIT_GENESIS_HASH } from '@repo/shared';
import { RedisClusterService } from '../../../infra/redis/redis-cluster.service';
import { assertActor, assertAppendable, type AuditActorContext } from '../domain/audit-log.entity';
import { calculateBlockHash } from '../domain/hash-chain.engine';
import { CryptoSignerEngine } from '../domain/crypto-signer.engine';
import { AuditLogRepository } from '../infrastructure/audit-log.repository';

export interface AuditAppendInput {
  actionCategory: string;
  actionName: string;
  targetEntity: string;
  targetEntityId?: string;
  payloadBefore?: unknown;
  payloadAfter?: unknown;
}

@Injectable()
export class AuditLogService {
  private readonly logger = new Logger(AuditLogService.name);

  constructor(
    private readonly redis: RedisClusterService,
    private readonly repo: AuditLogRepository,
    private readonly signer: CryptoSignerEngine,
  ) {}

  private async publish(event: string, fields: Record<string, string | number>): Promise<void> {
    try {
      await this.redis.xaddPipeline(AUDIT_EVENT_STREAM, [{ event, ...fields, at: Date.now() }]);
    } catch {
      // Telemetry never breaks audit flows.
    }
  }

  /** Append one hash-linked block (BDD-1). */
  async append(actor: AuditActorContext, input: AuditAppendInput): Promise<{ id: string; sequenceNumber: number | bigint; currentHash: string }> {
    assertAppendable('CREATE');
    assertActor(actor);
    if (!input.actionCategory || !input.actionName || !input.targetEntity) {
      throw new BadRequestException('Invalid audit payload');
    }
    const startedAt = Date.now();
    const head = await this.repo.latest();
    const previousHash = (head?.['currentHash'] as string | undefined) ?? AUDIT_GENESIS_HASH;
    const timestamp = new Date().toISOString();
    // Canonical link form: sequenceNumber is DB-assigned at insert, so the
    // committed hash binds 0 and order rides previousHash (see verifyChain).
    const provisional = calculateBlockHash({
      sequenceNumber: 0,
      actorId: actor.id,
      actionName: input.actionName,
      payloadBefore: input.payloadBefore ?? null,
      payloadAfter: input.payloadAfter ?? null,
      previousHash,
      timestamp,
    });
    const signature = this.signer.sign(provisional);
    const row = (await this.repo.append({
      userId: actor.id,
      action: `${input.actionCategory}:${input.actionName}`,
      details: input.payloadAfter ?? {},
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
      actorId: actor.id,
      actorRole: actor.role,
      actorEmail: actor.email,
      actionCategory: input.actionCategory,
      actionName: input.actionName,
      targetEntity: input.targetEntity,
      ...(input.targetEntityId ? { targetEntityId: input.targetEntityId } : {}),
      payloadBeforeJson: (input.payloadBefore ?? null) as Record<string, unknown> | null,
      payloadAfterJson: (input.payloadAfter ?? null) as Record<string, unknown> | null,
      previousHash,
      currentHash: provisional,
      signature,
      integrityStatus: 'PENDING_VAULT_SYNC',
    })) as { id: string; sequenceNumber: number | bigint };
    const elapsedMs = Date.now() - startedAt;
    if (elapsedMs > AUDIT_APPEND_BUDGET_MS) {
      this.logger.warn(`Append SLA breach: ${elapsedMs}ms`);
    }
    await this.publish('audit.appended', {
      auditId: row.id,
      actorId: actor.id,
      actionName: input.actionName,
      elapsedMs,
    });
    return { id: row.id, sequenceNumber: row.sequenceNumber, currentHash: provisional };
  }

  /** Paginated reads (auditor roles enforced by callers). */
  list(args: { actorId?: string; actionCategory?: string; integrityStatus?: string; page?: number; limit?: number }): Promise<Record<string, unknown>[]> {
    const page = Math.max(1, args.page ?? 1);
    const limit = Math.min(100, Math.max(1, args.limit ?? 20));
    return this.repo.list({
      ...(args.actorId ? { actorId: args.actorId } : {}),
      ...(args.actionCategory ? { actionCategory: args.actionCategory } : {}),
      ...(args.integrityStatus ? { integrityStatus: args.integrityStatus } : {}),
      skip: (page - 1) * limit,
      take: limit,
    });
  }

  /** Fail-closed chain verification over a bounded oldest-first window. */
  async verifyChain(skip = 0, take = 1000): Promise<{ valid: boolean; checked: number; brokenAt?: number | bigint; tamperedBlockSequences: number[] }> {
    const rows = await this.repo.window(skip, Math.min(5000, Math.max(1, take)));
    // Canonical form: the sequenceNumber is DB-assigned at insert, so the
    // committed hash binds sequence 0 and the *link* (previousHash) carries
    // order. Verification recomputes in that same canonical form — exact
    // and deterministic — while break reporting uses stored numbers.
    const ordered = [...rows].sort((a, b) => Number((a['sequenceNumber'] as number | bigint) ?? 0) - Number((b['sequenceNumber'] as number | bigint) ?? 0));
    let prev = AUDIT_GENESIS_HASH;
    const tampered: number[] = [];
    let brokenAt: number | bigint | undefined;
    for (const r of ordered) {
      const seq = (r['sequenceNumber'] as number | bigint) ?? 0;
      const ph = String(r['previousHash'] ?? '');
      const ch = String(r['currentHash'] ?? '');
      const expect = calculateBlockHash({
        sequenceNumber: 0,
        actorId: String(r['actorId'] ?? ''),
        actionName: String(r['actionName'] ?? ''),
        payloadBefore: r['payloadBeforeJson'] ?? null,
        payloadAfter: r['payloadAfterJson'] ?? null,
        previousHash: ph,
        timestamp: r['createdAt'] instanceof Date ? (r['createdAt'] as Date).toISOString() : String(r['createdAt'] ?? ''),
      });
      if (ph !== prev || expect !== ch) {
        tampered.push(Number(seq));
        if (brokenAt === undefined) brokenAt = seq;
      }
      prev = ch;
    }
    return { valid: tampered.length === 0, checked: ordered.length, ...(brokenAt !== undefined ? { brokenAt } : {}), tamperedBlockSequences: tampered };
  }
}
