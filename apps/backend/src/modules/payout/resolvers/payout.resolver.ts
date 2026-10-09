// SSOT Phase 086 §3.2/Gate 1 — Payout clearing intents (code-first)
// Canonical: apps/backend/src/modules/payout/resolvers/payout.resolver.ts
// (ADDITIVE: the §5.1 tree names no resolvers/ dir, but §3.2-equivalent
// intents need a code-first home — 079–085 precedent. api/graphql/
// payout.resolver.ts re-exports this file.)
// - Mutation.requestSellerPayout (KYC-gated) / approveClearingBatch /
//   Query.clearingQueue. Names avoid the 081 requestPayout field.
// - Zero new deps.
import { Args, Field, Float, ID, ObjectType, Query, Mutation, Resolver, Context } from '@nestjs/graphql';
import { BadRequestException } from '@nestjs/common';
import { RequestPayoutUseCase } from '../application/use-cases/request-payout.use-case';
import { ProcessBatchClearingUseCase } from '../application/use-cases/process-batch-clearing.use-case';
import { PrismaClearingStore } from '../infrastructure/clearing.store';

@ObjectType('SellerPayoutPayload')
class SellerPayoutPayloadGql {
  @Field() success!: boolean;
  @Field(() => ID) payoutId!: string;
  @Field(() => Float) grossAmount!: number;
  @Field(() => Float) taxAmount!: number;
  @Field(() => Float) netAmount!: number;
  @Field() status!: string;
}

@ObjectType('ClearingBatchPayload')
class ClearingBatchPayloadGql {
  @Field() batchNo!: string;
  @Field(() => [ID]) cleared!: string[];
  @Field() transRef!: string;
}

@ObjectType('ClearingQueueItem')
class ClearingQueueItemGql {
  @Field(() => ID) id!: string;
  @Field(() => ID) userId!: string;
  @Field(() => Float) grossAmount!: number;
  @Field(() => Float) netTransferAmount!: number;
  @Field() status!: string;
}

type LooseCtx = Record<string, unknown>;

function ctxOf(ctx: LooseCtx): { userId: string; tenantId: string; role?: string; ip: string } {
  const req = (ctx['req'] as Record<string, unknown> | undefined) ?? {};
  const user = (req['user'] as { id?: string; role?: string } | undefined) ?? {};
  const headers = (req['headers'] as Record<string, string> | undefined) ?? {};
  const tenantId = (((req['tenantId'] as string | undefined) ?? headers['x-tenant-id'] ?? '') as string).trim();
  if (!user.id || !tenantId) throw new BadRequestException('Missing payout context');
  const fwd = headers['x-forwarded-for'] ?? '';
  return {
    userId: user.id,
    tenantId,
    ...(user.role ? { role: user.role } : {}),
    ip: ((req['ip'] as string | undefined) ?? fwd.split(',')[0]?.trim() ?? '0.0.0.0'),
  };
}

@Resolver('PayoutClearing')
export class PayoutResolver {
  constructor(
    private readonly request: RequestPayoutUseCase,
    private readonly clearing: ProcessBatchClearingUseCase,
    private readonly store: PrismaClearingStore,
  ) {}

  @Mutation('requestSellerPayout')
  requestSellerPayout(
    @Args('amount') amount: number,
    @Args('bankAccountId') bankAccountId: string,
    @Args('remark', { nullable: true }) remark: string | undefined,
    @Context() ctx: LooseCtx,
  ) {
    const c = ctxOf(ctx);
    return this.request.execute({
      tenantId: c.tenantId,
      actorUserId: c.userId,
      body: { tenantId: c.tenantId, amount, bankAccountId, ...(remark ? { remark } : {}) },
      net: { ipAddress: c.ip },
    });
  }

  @Mutation('approveClearingBatch')
  approveClearingBatch(
    @Args('payoutIds', { type: () => [ID] }) payoutIds: string[],
    @Context() ctx: LooseCtx,
  ) {
    const c = ctxOf(ctx);
    return this.clearing.approveBatch({
      tenantId: c.tenantId,
      actorUserId: c.userId,
      ...(c.role ? { role: c.role } : {}),
      payoutIds,
    });
  }

  @Query('clearingQueue')
  clearingQueue(@Context() ctx: LooseCtx) {
    const c = ctxOf(ctx);
    return this.store.approvalQueue(c.tenantId);
  }

  @Query('clearingQueueCount')
  async clearingQueueCount(@Context() ctx: LooseCtx): Promise<number> {
    const rows = await this.clearingQueue(ctx);
    return (rows as ClearingQueueItemGql[]).length;
  }
}
