// SSOT Phase 118 Task 3 §3.2 — audit GraphQL intents (code-first)
// Canonical: apps/backend/src/modules/audit-log/presentation/audit-log.resolver.ts
// (legacy src/backend/modules/audit-log/presentation/audit-log.resolver.ts)
// - Query.auditLogs / Query.verifyAuditChain / Mutation.appendAuditLog.
//   Hash details gated to auditor roles (Gate 4, §2.1).
// - Zero new deps.
import { Args, Context, Field, Int, ObjectType, Query, Mutation, Resolver } from '@nestjs/graphql';
import { BadRequestException } from '@nestjs/common';
import { assertAuditViewer } from '../domain/audit-log.entity';
import { AuditLogService } from '../application/audit-log.service';
import { actorOf, assertCanRead, canRevealHashes, maskRowHashes, type LooseCtx } from './audit-view';

@ObjectType('AuditLogNode')
class AuditLogNodeGql {
  @Field() id!: string;
  @Field(() => Int) sequenceNumber!: number;
  @Field() actorId!: string;
  @Field() actorRole!: string;
  @Field() actorEmail!: string;
  @Field() actionCategory!: string;
  @Field() actionName!: string;
  @Field() targetEntity!: string;
  @Field({ nullable: true }) targetEntityId!: string | null;
  @Field() previousHash!: string;
  @Field() currentHash!: string;
  @Field() integrityStatus!: string;
  @Field() createdAt!: string;
}

@ObjectType('AuditVerifyResult')
class AuditVerifyResultGql {
  @Field() valid!: boolean;
  @Field(() => Int) checked!: number;
  @Field(() => [Int]) tamperedBlockSequences!: number[];
}

function toNode(row: Record<string, unknown>, revealHashes: boolean): AuditLogNodeGql {
  const out = new AuditLogNodeGql();
  out.id = String(row['id'] ?? '');
  out.sequenceNumber = Number(row['sequenceNumber'] ?? 0);
  out.actorId = String(row['actorId'] ?? '');
  out.actorRole = String(row['actorRole'] ?? '');
  out.actorEmail = String(row['actorEmail'] ?? '');
  out.actionCategory = String(row['actionCategory'] ?? '');
  out.actionName = String(row['actionName'] ?? '');
  out.targetEntity = String(row['targetEntity'] ?? '');
  out.targetEntityId = (row['targetEntityId'] as string | null | undefined) ?? null;
  // Gate 4 (§2.1): hash material only for auditor roles.
  const masked = maskRowHashes(
    { previousHash: String(row['previousHash'] ?? ''), currentHash: String(row['currentHash'] ?? '') },
    revealHashes,
  );
  out.previousHash = masked.previousHash;
  out.currentHash = masked.currentHash;
  out.integrityStatus = String(row['integrityStatus'] ?? '');
  out.createdAt = row['createdAt'] instanceof Date ? (row['createdAt'] as Date).toISOString() : String(row['createdAt'] ?? '');
  return out;
}

@Resolver('AuditLog')
export class AuditLogResolver {
  constructor(private readonly audit: AuditLogService) {}

  @Query('auditLogs')
  async auditLogs(
    @Args('actorId', { nullable: true }) actorId: string | undefined,
    @Args('actionCategory', { nullable: true }) actionCategory: string | undefined,
    @Args('page', { nullable: true }) page: number | undefined,
    @Args('limit', { nullable: true }) limit: number | undefined,
    @Context() ctx: LooseCtx,
  ) {
    const actor = actorOf(ctx);
    assertCanRead(actor.role);
    const reveal = canRevealHashes(actor.role);
    const rows = (await this.audit.list({
      ...(actorId ? { actorId } : {}),
      ...(actionCategory ? { actionCategory } : {}),
      page: page ?? 1,
      limit: limit ?? 20,
    })) as Record<string, unknown>[];
    return rows.map((row) => toNode(row, reveal));
  }

  @Query('verifyAuditChain')
  verifyAuditChain(@Args('take', { nullable: true }) take: number | undefined, @Context() ctx: LooseCtx) {
    const actor = actorOf(ctx);
    assertAuditViewer(actor.role);
    return this.audit.verifyChain(0, take ?? 1000);
  }

  @Mutation('appendAuditLog')
  appendAuditLog(
    @Args('actionCategory') actionCategory: string,
    @Args('actionName') actionName: string,
    @Args('targetEntity') targetEntity: string,
    @Context() ctx: LooseCtx,
  ) {
    const actor = actorOf(ctx);
    if (!actor.id) throw new BadRequestException('Missing authentication');
    return this.audit.append(
      { id: actor.id, role: actor.role, email: actor.email, ipAddress: actor.ip, userAgent: actor.ua },
      { actionCategory, actionName, targetEntity },
    );
  }
}
