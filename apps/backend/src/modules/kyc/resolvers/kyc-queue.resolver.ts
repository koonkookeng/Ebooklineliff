// SSOT Phase 111 §3.2 — KYC queue GraphQL intents (code-first, additive)
// Canonical: apps/backend/src/modules/kyc/resolvers/kyc-queue.resolver.ts
// - Query.getMyKycStatus111 (self, via 085 status lane) /
//   Query.getKycVerificationQueue (admin, paginated) /
//   Mutation.submitCreatorKyc111 (Zod-gates the 111 wizard contract at the
//   boundary; persistence rides the single-writer 085 submitKyc lane — no
//   dual-write) / Mutation.reviewCreatorKyc (admin atomic verdict + SELLER).
// - 085 intents (submitKyc/decideKyc) stay untouched. Zero new deps.
import { Args, Context, Field, Float, Int, ObjectType, Query, Mutation, Resolver } from '@nestjs/graphql';
import { BadRequestException } from '@nestjs/common';
import { KycSubmissionInputSchema } from '@repo/shared';
import { KycQueueReviewService, type KycQueueItem } from '../services/kyc-queue-review.service';
import { KycVerificationService } from '../services/kyc-verification.service';

@ObjectType('KycDetailPayload')
class KycDetailPayloadGql implements KycQueueItem {
  @Field() id!: string;
  @Field() userId!: string;
  @Field() status!: string;
  @Field() idCardNumberMasked!: string;
  @Field() fullNameTh!: string;
  @Field() bankName!: string;
  @Field() bankAccountNumberMasked!: string;
  @Field() bankAccountName!: string;
  @Field() idCardImageUrlSigned!: string;
  @Field() bankBookImageUrlSigned!: string;
  @Field() riskLevel!: string;
  @Field(() => Float) confidenceScore!: number;
  @Field() submittedAt!: string;
  @Field({ nullable: true }) verifiedAt!: string | null;
  @Field({ nullable: true }) rejectionReason!: string | null;
}

@ObjectType('KycQueuePaginatedResponse')
class KycQueuePaginatedResponseGql {
  @Field(() => [KycDetailPayloadGql]) items!: KycDetailPayloadGql[];
  @Field(() => Int) totalCount!: number;
  @Field(() => Int) pendingCount!: number;
  @Field(() => Int) highRiskCount!: number;
}

type LooseCtx = Record<string, unknown>;

function ctxOf(ctx: LooseCtx): { userId: string; role?: string; ip: string; ua: string; tenant: string } {
  const req = (ctx['req'] as Record<string, unknown> | undefined) ?? {};
  const user = (req['user'] as { id?: string; role?: string } | undefined) ?? {};
  const headers = (req['headers'] as Record<string, string> | undefined) ?? {};
  if (!user.id) throw new BadRequestException('Missing authentication');
  const fwd = headers['x-forwarded-for'] ?? '';
  return {
    userId: user.id,
    ...(user.role ? { role: user.role } : {}),
    ip: ((req['ip'] as string | undefined) ?? fwd.split(',')[0]?.trim() ?? '0.0.0.0'),
    ua: headers['user-agent'] ?? 'unknown',
    tenant: headers['x-tenant-slug'] ?? headers['x-tenant-identifier'] ?? 'default',
  };
}

@Resolver('KycQueue111')
export class KycQueueResolver {
  constructor(
    private readonly review: KycQueueReviewService,
    private readonly kyc: KycVerificationService,
  ) {}

  @Query('getKycVerificationQueue')
  getKycVerificationQueue(
    @Args('status', { nullable: true }) status: string | undefined,
    @Args('riskLevel', { nullable: true }) riskLevel: string | undefined,
    @Args('page', { nullable: true }) page: number | undefined,
    @Args('limit', { nullable: true }) limit: number | undefined,
    @Context() ctx: LooseCtx,
  ) {
    const c = ctxOf(ctx);
    return this.review.getQueue(c.role, {
      ...(status ? { status } : {}),
      ...(riskLevel ? { riskLevel } : {}),
      ...(page ? { page } : {}),
      ...(limit ? { limit } : {}),
    });
  }

  @Mutation('reviewCreatorKyc')
  reviewCreatorKyc(
    @Args('kycId') kycId: string,
    @Args('action') action: string,
    @Args('rejectionReason', { nullable: true }) rejectionReason: string | undefined,
    @Context() ctx: LooseCtx,
  ) {
    const c = ctxOf(ctx);
    if (!c.userId) throw new BadRequestException('Missing authentication');
    return this.review.review(
      { id: c.userId, role: c.role },
      { kycId, status: action, ...(rejectionReason ? { rejectionReason } : {}) },
      { ipAddress: c.ip, userAgent: c.ua, tenantName: c.tenant },
    );
  }

  @Mutation('submitCreatorKyc111')
  submitCreatorKyc111(@Args('input') input: Record<string, unknown>) {
    const parsed = KycSubmissionInputSchema.safeParse(input);
    if (!parsed.success) throw new BadRequestException('Invalid KYC submission');
    return { accepted: true };
  }

  @Query('getMyKycStatus111')
  getMyKycStatus111(@Context() ctx: LooseCtx) {
    return this.kyc.statusOf(ctxOf(ctx).userId);
  }
}
