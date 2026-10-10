// SSOT Phase 113 Task 2 §3.2 — dispute GraphQL intents (code-first)
// Canonical: apps/backend/src/modules/dispute/dispute.resolver.ts
// (legacy src/backend/modules/dispute/dispute.resolver.ts)
// - Query.getDisputeByOrder / Query.getEscrowStatus /
//   Mutation.createDisputeClaim / Mutation.resolveDisputeArbitration.
// - Zero new deps.
import { Args, Context, Field, Float, ObjectType, Query, Mutation, Resolver } from '@nestjs/graphql';
import { BadRequestException } from '@nestjs/common';
import { DisputeService } from './dispute.service';
import { EscrowService } from '../escrow/escrow.service';

@ObjectType('DisputeEvidenceGql')
class DisputeEvidenceGql {
  @Field() id!: string;
  @Field() fileUrl!: string;
  @Field() fileType!: string;
  @Field() uploadedAt!: string;
}

@ObjectType('DisputeClaimPayload')
class DisputeClaimPayloadGql {
  @Field() id!: string;
  @Field() disputeNo!: string;
  @Field() orderId!: string;
  @Field() reason!: string;
  @Field() description!: string;
  @Field() status!: string;
  @Field(() => Float) requestedRefundAmount!: number;
  @Field(() => Float, { nullable: true }) approvedRefundAmount!: number | null;
  @Field(() => [DisputeEvidenceGql]) evidences!: DisputeEvidenceGql[];
  @Field() createdAt!: string;
  @Field() updatedAt!: string;
}

@ObjectType('EscrowStatusPayload')
class EscrowStatusPayloadGql {
  @Field() escrowId!: string;
  @Field() orderId!: string;
  @Field(() => Float) grossAmount!: number;
  @Field() holdingUntil!: string;
  @Field() status!: string;
}

type LooseCtx = Record<string, unknown>;

function ctxOf(ctx: LooseCtx): { userId: string; role: string | undefined; tenant: string } {
  const req = (ctx['req'] as Record<string, unknown> | undefined) ?? {};
  const user = (req['user'] as { id?: string; role?: string } | undefined) ?? {};
  const headers = (req['headers'] as Record<string, string> | undefined) ?? {};
  if (!user.id) throw new BadRequestException('Missing authentication');
  return {
    userId: user.id,
    role: user.role,
    tenant: headers['x-tenant-slug'] ?? headers['x-tenant-identifier'] ?? 'default',
  };
}

@Resolver('Dispute')
export class DisputeResolver {
  constructor(
    private readonly disputes: DisputeService,
    private readonly escrow: EscrowService,
  ) {}

  @Query('getDisputeByOrder')
  getDisputeByOrder(@Args('orderId') orderId: string, @Context() ctx: LooseCtx) {
    const c = ctxOf(ctx);
    return this.disputes.getByOrder(orderId, { id: c.userId, role: c.role });
  }

  @Query('getEscrowStatus')
  getEscrowStatus(@Args('orderId') orderId: string, @Context() ctx: LooseCtx) {
    const c = ctxOf(ctx);
    return this.escrow.getStatus(orderId, { id: c.userId, role: c.role });
  }

  @Mutation('createDisputeClaim')
  createDisputeClaim(@Args('input') input: Record<string, unknown>, @Context() ctx: LooseCtx) {
    const c = ctxOf(ctx);
    return this.disputes.createDisputeClaim(c.userId, input, c.tenant);
  }

  @Mutation('resolveDisputeArbitration')
  resolveDisputeArbitration(@Args('input') input: Record<string, unknown>, @Context() ctx: LooseCtx) {
    const c = ctxOf(ctx);
    if (!c.userId) throw new BadRequestException('Missing authentication');
    return this.disputes.resolveArbitration({ id: c.userId, role: c.role }, input, c.tenant);
  }
}
